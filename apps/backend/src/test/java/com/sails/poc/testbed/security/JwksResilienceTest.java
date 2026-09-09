package com.sails.poc.testbed.security;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.mock.http.client.MockClientHttpResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.client.RestOperations;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.context.WebApplicationContext;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

/**
 * Key rollover, and what happens when the key service is down.
 *
 * The two requirements pull in opposite directions and are easy to get backwards: an unknown
 * {@code kid} must trigger a refresh so a rotated-in key starts working without a redeploy, and a
 * key that still cannot be resolved must deny the request rather than being waved through
 * (integration guide §4 — "if the key cannot be resolved or verified, deny the request; do not
 * accept an unverified token during a JWKS outage").
 *
 * Ordered, because they share one application context and therefore one JWKS cache: the rollover
 * has to happen against a healthy endpoint before the outage takes it away.
 */
@SpringBootTest(
        properties = {
            "poc.slug=testbed",
            "poc.expected-issuer=self-service-api",
            "poc.platform-api-url=https://platform-api.test",
            "spring.main.allow-bean-definition-overriding=true"
        })
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisplayName("JWKS rollover and outage")
class JwksResilienceTest {

    private static final String ISSUER = "self-service-api";
    private static final String AUDIENCE = "poc:testbed";

    private static final RSAKey ORIGINAL_KEY = generate("key-original");
    private static final RSAKey ROTATED_IN_KEY = generate("key-rotated-in");
    private static final RSAKey NEVER_PUBLISHED_KEY = generate("key-never-published");

    /** What the stubbed key service currently publishes. */
    private static volatile List<JWK> published = List.of(ORIGINAL_KEY.toPublicJWK());

    /** When false, the key service is down. */
    private static volatile boolean reachable = true;

    @TestConfiguration
    static class SwitchableJwks {

        @Bean
        RestOperations jwksRestOperations() {
            return new RestTemplate((uri, method) -> {
                if (!reachable) {
                    throw new java.io.IOException("JWKS endpoint is down");
                }
                byte[] body = new JWKSet(published).toString().getBytes(StandardCharsets.UTF_8);
                MockClientHttpRequest request = new MockClientHttpRequest(method, uri);
                MockClientHttpResponse response = new MockClientHttpResponse(body, HttpStatus.OK);
                response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
                request.setResponse(response);
                return request;
            });
        }
    }

    @Autowired
    private WebApplicationContext context;

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        // VerificationOutageFilter is added explicitly because MockMvc does not pick up servlet
        // filters registered as beans — only the security chain, via springSecurity(). In a real
        // deployment its registration order (-200) already puts it ahead of Spring Security's
        // (-100); adding it first here reproduces that.
        mvc = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(new VerificationOutageFilter())
                .apply(springSecurity())
                .build();
    }

    @Test
    @Order(1)
    @DisplayName("the originally published key verifies")
    void originalKeyWorks() throws Exception {
        mvc.perform(whoami(ORIGINAL_KEY)).andExpect(status().isOk());
    }

    @Test
    @Order(2)
    @DisplayName("a key rotated in after startup is picked up without a redeploy")
    void rollover() throws Exception {
        published = List.of(ORIGINAL_KEY.toPublicJWK(), ROTATED_IN_KEY.toPublicJWK());

        // Unknown kid, so the decoder must go back for the key set rather than reject from cache.
        mvc.perform(whoami(ROTATED_IN_KEY)).andExpect(status().isOk());
        // ...and the key it already had keeps working.
        mvc.perform(whoami(ORIGINAL_KEY)).andExpect(status().isOk());
    }

    @Test
    @Order(3)
    @DisplayName("an unresolvable key is denied while the key service is down, never accepted unverified")
    void outageFailsClosed() throws Exception {
        reachable = false;
        try {
            // 503, not 401: the credential was not rejected, it could not be checked. What matters
            // for the contract is that it is not 2xx — the request is denied either way.
            mvc.perform(whoami(NEVER_PUBLISHED_KEY)).andExpect(status().isServiceUnavailable());
        } finally {
            reachable = true;
        }
    }

    @Test
    @Order(4)
    @DisplayName("the key service recovering restores normal verification")
    void recovers() throws Exception {
        mvc.perform(whoami(ORIGINAL_KEY)).andExpect(status().isOk());
    }

    // ----------------------------------------------------------------------------------- fixtures

    private static org.springframework.test.web.servlet.RequestBuilder whoami(RSAKey key) throws Exception {
        return get("/api/session/whoami").header(HttpHeaders.AUTHORIZATION, "Bearer " + signedWith(key));
    }

    private static RSAKey generate(String keyId) {
        try {
            return new RSAKeyGenerator(2048).keyID(keyId).generate();
        } catch (Exception e) {
            throw new IllegalStateException("could not generate " + keyId, e);
        }
    }

    private static String signedWith(RSAKey key) throws Exception {
        Instant now = Instant.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(ISSUER)
                .subject("user-1")
                .audience(AUDIENCE)
                .claim("pocId", 42)
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plus(15, ChronoUnit.MINUTES)))
                .build();

        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).build(), claims);
        jwt.sign(new RSASSASigner(key));
        return jwt.serialize();
    }
}

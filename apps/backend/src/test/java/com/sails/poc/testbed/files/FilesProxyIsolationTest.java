package com.sails.poc.testbed.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.function.Consumer;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.ClientHttpRequestFactory;
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
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

/**
 * What this POC is responsible for in file isolation, and what it is not.
 *
 * The platform derives both the user and the POC from the token, so it — not this backend — is
 * what stops user A reading user B's file. This POC's job is narrower and entirely testable: send
 * the caller's <em>own</em> verified token, send nothing that could be used to name a different
 * user or POC, and relay the platform's refusal instead of masking it.
 *
 * These assert exactly that, by capturing what leaves the backend. The upstream platform is
 * stubbed; capturing the outbound request is the point.
 */
@SpringBootTest(
        properties = {
            "poc.slug=testbed",
            "poc.expected-issuer=self-service-api",
            "poc.platform-api-url=https://platform-api.test",
            "spring.main.allow-bean-definition-overriding=true"
        })
@DisplayName("File proxy isolation")
class FilesProxyIsolationTest {

    private static final String ISSUER = "self-service-api";
    private static final String AUDIENCE = "poc:testbed";
    private static final RSAKey SIGNING_KEY = generate();

    /** Every request the backend sent upstream, in order. */
    private static final List<MockClientHttpRequest> SENT = new ArrayList<>();

    /** What the stubbed platform answers with next. */
    private static HttpStatus nextStatus = HttpStatus.OK;
    private static String nextBody = "[]";
    private static Consumer<HttpHeaders> nextHeaders = headers -> headers.setContentType(MediaType.APPLICATION_JSON);

    @TestConfiguration
    static class StubPlatform {

        /** Serves the fixture JWKS to the decoder, so tokens verify for real. */
        @Bean
        RestOperations jwksRestOperations() {
            byte[] jwks = new JWKSet(SIGNING_KEY.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
            return new RestTemplate((uri, method) -> {
                MockClientHttpRequest request = new MockClientHttpRequest(method, uri);
                MockClientHttpResponse response = new MockClientHttpResponse(jwks, HttpStatus.OK);
                response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
                request.setResponse(response);
                return request;
            });
        }

        /** Captures what the file proxy sends, and answers with whatever the test arranged. */
        @Bean
        ClientHttpRequestFactory platformApiRequestFactory() {
            return (uri, method) -> {
                MockClientHttpRequest request = new MockClientHttpRequest(method, uri);
                MockClientHttpResponse response =
                        new MockClientHttpResponse(nextBody.getBytes(StandardCharsets.UTF_8), nextStatus);
                nextHeaders.accept(response.getHeaders());
                request.setResponse(response);
                SENT.add(request);
                return request;
            };
        }
    }

    @Autowired
    private WebApplicationContext context;

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        SENT.clear();
        nextStatus = HttpStatus.OK;
        nextBody = "[]";
        nextHeaders = headers -> headers.setContentType(MediaType.APPLICATION_JSON);
    }

    @Test
    @DisplayName("forwards the caller's own token, unchanged, to the platform")
    void forwardsCallerToken() throws Exception {
        String token = tokenFor("user-a");

        mvc.perform(get("/api/files").header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk());

        assertThat(SENT).hasSize(1);
        assertThat(SENT.getFirst().getHeaders().getFirst(HttpHeaders.AUTHORIZATION))
                .isEqualTo("Bearer " + token);
    }

    @Test
    @DisplayName("two users' requests each carry their own token, never a cached first one")
    void doesNotShareTokensBetweenCallers() throws Exception {
        String tokenA = tokenFor("user-a");
        String tokenB = tokenFor("user-b");

        mvc.perform(get("/api/files").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenA));
        mvc.perform(get("/api/files").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenB));

        assertThat(SENT).hasSize(2);
        assertThat(SENT.get(0).getHeaders().getFirst(HttpHeaders.AUTHORIZATION)).isEqualTo("Bearer " + tokenA);
        assertThat(SENT.get(1).getHeaders().getFirst(HttpHeaders.AUTHORIZATION)).isEqualTo("Bearer " + tokenB);
        // The distinct-token assertion is the point: a shared client that captured the first
        // caller's credential would make both of these identical.
        assertThat(tokenA).isNotEqualTo(tokenB);
    }

    @Test
    @DisplayName("sends no user or POC parameter the platform could be talked out of deriving itself")
    void sendsNoIdentityParameters() throws Exception {
        mvc.perform(get("/api/files").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenFor("user-a")));

        URI uri = SENT.getFirst().getURI();
        assertThat(uri.getPath()).isEqualTo("/poc-files");
        assertThat(uri.getQuery()).as("no query string at all").isNull();
    }

    @Test
    @DisplayName("a caller-supplied file id is passed through for the platform to authorize, not trusted here")
    void relaysFileIdWithoutInterpretingIt() throws Exception {
        mvc.perform(delete("/api/files/99").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenFor("user-a")));

        assertThat(SENT.getFirst().getURI().getPath()).isEqualTo("/poc-files/99");
        assertThat(SENT.getFirst().getMethod()).isEqualTo(HttpMethod.DELETE);
    }

    @Test
    @DisplayName("the platform's refusal of another user's file is relayed, not masked")
    void relaysNotFound() throws Exception {
        nextStatus = HttpStatus.NOT_FOUND;
        nextBody = "{\"error\":\"not found\"}";

        mvc.perform(get("/api/files/12345/content").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenFor("user-a")))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("quota and size refusals keep their own status codes")
    void relaysQuotaAndSizeFailures() throws Exception {
        nextStatus = HttpStatus.CONFLICT;
        mvc.perform(get("/api/files").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenFor("user-a")))
                .andExpect(status().isConflict());

        nextStatus = HttpStatus.PAYLOAD_TOO_LARGE;
        mvc.perform(get("/api/files").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenFor("user-a")))
                .andExpect(status().isPayloadTooLarge());
    }

    @Test
    @DisplayName("upstream framing headers are not relayed to the browser")
    void dropsUpstreamFramingHeaders() throws Exception {
        nextHeaders = headers -> {
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set(HttpHeaders.TRANSFER_ENCODING, "chunked");
            headers.set(HttpHeaders.CONNECTION, "keep-alive");
            headers.set("X-Platform-Internal", "leaked");
        };

        var result = mvc.perform(get("/api/files").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenFor("user-a")))
                .andExpect(status().isOk())
                .andReturn();

        assertThat(result.getResponse().getHeader(HttpHeaders.TRANSFER_ENCODING)).isNull();
        assertThat(result.getResponse().getHeader(HttpHeaders.CONNECTION)).isNull();
        assertThat(result.getResponse().getHeader("X-Platform-Internal")).isNull();
        assertThat(result.getResponse().getContentType()).contains(MediaType.APPLICATION_JSON_VALUE);
    }

    @Test
    @DisplayName("an unauthenticated caller never reaches the platform at all")
    void unauthenticatedNeverForwards() throws Exception {
        mvc.perform(get("/api/files")).andExpect(status().isUnauthorized());

        assertThat(SENT).isEmpty();
    }

    // ----------------------------------------------------------------------------------- fixtures

    private static RSAKey generate() {
        try {
            return new RSAKeyGenerator(2048).keyID("test-key-1").generate();
        } catch (Exception e) {
            throw new IllegalStateException("could not generate the signing fixture", e);
        }
    }

    private static String tokenFor(String subject) throws Exception {
        Instant now = Instant.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(ISSUER)
                .subject(subject)
                .audience(AUDIENCE)
                .claim("pocId", 42)
                .jwtID("token-" + subject)
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plus(15, ChronoUnit.MINUTES)))
                .build();

        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(SIGNING_KEY.getKeyID()).build(), claims);
        jwt.sign(new RSASSASigner(SIGNING_KEY));
        return jwt.serialize();
    }
}

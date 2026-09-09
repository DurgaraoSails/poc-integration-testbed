package com.sails.poc.testbed.security;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

/**
 * Exercises the real verification chain — the real {@link org.springframework.security.oauth2.jwt.NimbusJwtDecoder}
 * built by {@link com.sails.poc.testbed.config.SecurityConfig}, the real validators, real RSA
 * signatures, and the real security filter chain via MockMvc.
 *
 * The one thing substituted is the transport that fetches the key set: {@code jwksRestOperations}
 * is overridden with an in-memory client that answers with a fixture JWKS. That keeps the decoder,
 * its algorithm pinning, its {@code kid} selection and every validator under test while needing no
 * socket — this suite has to run on machines and CI images where binding a loopback port is not
 * available.
 *
 * The fixture keys never leave this test, and nothing in the application accepts them: the only
 * thing arranged here is where the public keys come from.
 */
@SpringBootTest(
        properties = {
            "poc.slug=testbed",
            "poc.expected-issuer=self-service-api",
            "poc.platform-api-url=https://platform-api.test",
            // Lets FixtureJwks below replace SecurityConfig's jwksRestOperations. Test-only, and
            // reliable because a @TestConfiguration is registered after the application's own.
            "spring.main.allow-bean-definition-overriding=true"
        })
@DisplayName("POC token verification")
class JwtVerificationTest {

    private static final String ISSUER = "self-service-api";
    private static final String AUDIENCE = "poc:testbed";

    private static final RSAKey SIGNING_KEY = generate("test-key-1");
    private static final RSAKey UNPUBLISHED_KEY = generate("rotated-out-key");

    /**
     * Replaces only the HTTP client the decoder fetches keys with. Everything downstream of the
     * bytes — parsing, caching, {@code kid} matching, signature verification — is the real thing.
     */
    @TestConfiguration
    static class FixtureJwks {

        @Bean
        RestOperations jwksRestOperations() {
            byte[] jwks = new JWKSet(SIGNING_KEY.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);

            ClientHttpRequestFactory factory = (uri, method) -> {
                MockClientHttpRequest request = new MockClientHttpRequest(method, uri);
                MockClientHttpResponse response = new MockClientHttpResponse(jwks, HttpStatus.OK);
                response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
                request.setResponse(response);
                return request;
            };
            return new RestTemplate(factory);
        }
    }

    @Autowired
    private WebApplicationContext context;

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    // ---------------------------------------------------------------- happy path and open routes

    @Test
    @DisplayName("a valid token authenticates as its verified subject")
    void validToken() throws Exception {
        mvc.perform(whoami(token(claims -> { })))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true))
                .andExpect(jsonPath("$.subject").value("user-1"))
                .andExpect(jsonPath("$.issuer").value(ISSUER));
    }

    @Test
    @DisplayName("the health probe needs no token")
    void healthIsOpen() throws Exception {
        mvc.perform(get("/healthz")).andExpect(status().isOk());
    }

    // ----------------------------------------------------------------------- missing credentials

    @Test
    @DisplayName("chat is not reachable without a token, canned replies notwithstanding")
    void chatRequiresAuthentication() throws Exception {
        mvc.perform(post("/api/chat")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"message\":\"hello\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("chat works with a valid token")
    void chatWithToken() throws Exception {
        mvc.perform(post("/api/chat")
                        .header(HttpHeaders.AUTHORIZATION, bearer(token(claims -> { })))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"message\":\"hello\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reply").isNotEmpty());
    }

    @Test
    @DisplayName("files are not reachable without a token")
    void filesRequireAuthentication() throws Exception {
        mvc.perform(get("/api/files")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("a malformed Authorization header is rejected")
    void malformedCredential() throws Exception {
        mvc.perform(whoami("not-a-jwt")).andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------------------------- signature and alg

    @Test
    @DisplayName("a token signed by a key that is not published is rejected")
    void unknownKid() throws Exception {
        mvc.perform(whoami(signedWith(UNPUBLISHED_KEY, claims -> { }))).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("a token whose signature has been tampered with is rejected")
    void tamperedSignature() throws Exception {
        String[] parts = token(claims -> { }).split("\\.");
        // Flip a character in the signature, keeping it valid base64url.
        char[] signature = parts[2].toCharArray();
        signature[0] = signature[0] == 'A' ? 'B' : 'A';
        String tampered = parts[0] + "." + parts[1] + "." + new String(signature);

        mvc.perform(whoami(tampered)).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("a payload swapped under a valid signature is rejected")
    void swappedPayload() throws Exception {
        String[] mine = token(claims -> { }).split("\\.");
        String[] theirs = token(c -> c.subject("someone-else")).split("\\.");
        // Their payload, my header and signature: the signature no longer covers the claims.
        String frankenstein = mine[0] + "." + theirs[1] + "." + mine[2];

        mvc.perform(whoami(frankenstein)).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("an unsigned token (alg: none) is rejected")
    void unsignedToken() throws Exception {
        String header = base64Url("{\"alg\":\"none\"}");
        String payload = base64Url(baseClaims().build().toString());
        // The empty third segment is what "alg: none" looks like on the wire.
        String unsigned = header + "." + payload + ".";

        mvc.perform(whoami(unsigned)).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("a portal access token — no POC audience — is rejected")
    void portalAccessToken() throws Exception {
        mvc.perform(whoami(token(c -> c.audience("self-service-portal").claim("pocId", null))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("a symmetric HS256 token is rejected: only RS256 is allowed")
    void disallowedAlgorithm() throws Exception {
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.HS256).build(), baseClaims().build());
        jwt.sign(new MACSigner("a-symmetric-secret-long-enough-for-hs256!!".getBytes(StandardCharsets.UTF_8)));

        mvc.perform(whoami(jwt.serialize())).andExpect(status().isUnauthorized());
    }

    // ----------------------------------------------------------------------- issuer and audience

    @Test
    @DisplayName("a token from another issuer is rejected")
    void wrongIssuer() throws Exception {
        mvc.perform(whoami(token(c -> c.issuer("https://not-the-platform"))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("another POC's token is rejected")
    void otherPocAudience() throws Exception {
        mvc.perform(whoami(token(c -> c.audience("poc:some-other-poc"))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("this POC's audience alongside another's is rejected as ambiguous")
    void ambiguousAudience() throws Exception {
        mvc.perform(whoami(token(c -> c.audience(List.of(AUDIENCE, "poc:some-other-poc")))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("a token with no audience at all is rejected")
    void missingAudience() throws Exception {
        mvc.perform(whoami(token(c -> c.audience(List.of())))).andExpect(status().isUnauthorized());
    }

    // ---------------------------------------------------------------------- expiry and claim types

    @Test
    @DisplayName("an expired token is rejected")
    void expired() throws Exception {
        Instant past = Instant.now().minus(2, ChronoUnit.HOURS);
        mvc.perform(whoami(token(c -> c.expirationTime(Date.from(past))))).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("a token with no exp is rejected, not treated as non-expiring")
    void missingExpiry() throws Exception {
        mvc.perform(whoami(token(c -> c.expirationTime(null)))).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("a token whose nbf is in the future is rejected")
    void notYetValid() throws Exception {
        Instant future = Instant.now().plus(1, ChronoUnit.HOURS);
        mvc.perform(whoami(token(c -> c.notBeforeTime(Date.from(future))))).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("a blank sub is rejected")
    void blankSubject() throws Exception {
        mvc.perform(whoami(token(c -> c.subject("   ")))).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("a missing pocId is rejected")
    void missingPocId() throws Exception {
        mvc.perform(whoami(token(c -> c.claim("pocId", null)))).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("a non-positive or non-integral pocId is rejected")
    void malformedPocId() throws Exception {
        for (Object bad : List.of(0, -3, "42", 4.5)) {
            mvc.perform(whoami(token(c -> c.claim("pocId", bad))))
                    .andExpect(status().isUnauthorized());
        }
    }

    // -------------------------------------------------------------------------------------- trial

    @Test
    @DisplayName("an expired trial denies with 403, not 401 — the token itself is still valid")
    void trialExpired() throws Exception {
        long past = Instant.now().minus(1, ChronoUnit.DAYS).getEpochSecond();
        mvc.perform(whoami(token(c -> c.claim("trialEndDate", past)))).andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a trial still running is allowed")
    void trialActive() throws Exception {
        long future = Instant.now().plus(30, ChronoUnit.DAYS).getEpochSecond();
        mvc.perform(whoami(token(c -> c.claim("trialEndDate", future)))).andExpect(status().isOk());
    }

    @Test
    @DisplayName("an absent trial claim means no restriction, and grants nothing extra")
    void trialAbsent() throws Exception {
        mvc.perform(whoami(token(c -> { }))).andExpect(status().isOk());
    }

    @Test
    @DisplayName("a malformed trial claim fails closed")
    void trialMalformed() throws Exception {
        mvc.perform(whoami(token(c -> c.claim("trialEndDate", "next tuesday"))))
                .andExpect(status().isForbidden());
    }

    // ----------------------------------------------------------------------------------- fixtures

    private static org.springframework.test.web.servlet.RequestBuilder whoami(String token) {
        return get("/api/session/whoami").header(HttpHeaders.AUTHORIZATION, bearer(token));
    }

    private static String bearer(String token) {
        return "Bearer " + token;
    }

    private static String base64Url(String value) {
        return java.util.Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static RSAKey generate(String keyId) {
        try {
            return new RSAKeyGenerator(2048).keyID(keyId).generate();
        } catch (Exception e) {
            throw new IllegalStateException("could not generate the " + keyId + " fixture", e);
        }
    }

    private static JWTClaimsSet.Builder baseClaims() {
        Instant now = Instant.now();
        return new JWTClaimsSet.Builder()
                .issuer(ISSUER)
                .subject("user-1")
                .audience(AUDIENCE)
                .claim("pocId", 42)
                .claim("name", "Test User")
                .claim("theme", "LIGHT")
                .jwtID("token-1")
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plus(15, ChronoUnit.MINUTES)));
    }

    private static String token(Consumer<JWTClaimsSet.Builder> customize) throws Exception {
        return signedWith(SIGNING_KEY, customize);
    }

    private static String signedWith(RSAKey key, Consumer<JWTClaimsSet.Builder> customize) throws Exception {
        JWTClaimsSet.Builder claims = baseClaims();
        customize.accept(claims);
        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).build(), claims.build());
        jwt.sign(new RSASSASigner(key));
        return jwt.serialize();
    }
}

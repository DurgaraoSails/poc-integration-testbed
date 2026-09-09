package com.sails.poc.testbed.config;

import java.time.Duration;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.client.RestOperations;
import org.springframework.web.client.RestTemplate;

import com.sails.poc.testbed.security.ClaimEqualsValidator;
import com.sails.poc.testbed.security.PocAudienceValidator;
import com.sails.poc.testbed.security.RequiredPocClaimsValidator;
import com.sails.poc.testbed.security.TrialAuthorizationManager;
import com.sails.poc.testbed.security.VerificationOutageFilter;

/**
 * Verification of every incoming {@code Authorization: Bearer <jwt>}: RS256 signature against the
 * platform's published JWKS, then issuer, audience, expiry and required claims.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    /**
     * Small and explicit, per guide §4.6. Wide skew is how an expired token keeps working; the fix
     * for drifting clocks is NTP, not a bigger window here.
     */
    private static final Duration CLOCK_SKEW = Duration.ofSeconds(30);

    /** A JWKS fetch is on the critical path of every first-use of a new key. Bound it. */
    private static final Duration JWKS_CONNECT_TIMEOUT = Duration.ofSeconds(3);
    private static final Duration JWKS_READ_TIMEOUT = Duration.ofSeconds(3);

    @Bean
    public JwtDecoder jwtDecoder(PocProperties props, RestOperations jwksRestOperations) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(props.jwksUri())
                // Explicit, not inherited from a library default: the guide §4.1/§4.3 requires the
                // backend to name the algorithm it accepts, so that a token presenting any other
                // one — including "none" — is rejected on its header before anything else runs.
                .jwsAlgorithm(SignatureAlgorithm.RS256)
                .restOperations(jwksRestOperations)
                .build();

        OAuth2TokenValidator<Jwt> issuer = new ClaimEqualsValidator("iss", props.expectedIssuer());
        OAuth2TokenValidator<Jwt> audience = new PocAudienceValidator(props.expectedAudience());
        OAuth2TokenValidator<Jwt> requiredClaims = new RequiredPocClaimsValidator();
        OAuth2TokenValidator<Jwt> timestamps = new JwtTimestampValidator(CLOCK_SKEW);

        decoder.setJwtValidator(
                new DelegatingOAuth2TokenValidator<>(issuer, audience, requiredClaims, timestamps));
        return decoder;
    }

    /**
     * The JWKS cache is Nimbus's, left at its defaults on purpose: a bounded lifetime, a
     * rate-limited refresh when an unknown {@code kid} shows up, and refresh-ahead so a live
     * request rarely waits on the network. Those are exactly the properties guide §4 asks for, and
     * passing a plain {@code .cache(Cache)} here would <em>replace</em> them with a bare map that
     * has none of the rate limiting.
     *
     * What the defaults do not include is a network timeout, which is what this supplies. Nimbus's
     * outage tolerance also stays off, deliberately: if the keys cannot be resolved the request is
     * denied. An unverified token must never be accepted because the platform was unreachable.
     */
    @Bean
    public RestOperations jwksRestOperations() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(JWKS_CONNECT_TIMEOUT);
        factory.setReadTimeout(JWKS_READ_TIMEOUT);
        return new RestTemplate(factory);
    }

    /**
     * Wraps the security chain so a key-service outage answers 503 rather than escaping as a 500.
     * See {@link VerificationOutageFilter} for why it is not a 401.
     */
    @Bean
    public FilterRegistrationBean<VerificationOutageFilter> verificationOutageFilter() {
        FilterRegistrationBean<VerificationOutageFilter> registration =
                new FilterRegistrationBean<>(new VerificationOutageFilter());
        registration.setOrder(VerificationOutageFilter.ORDER);
        return registration;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, JwtDecoder jwtDecoder) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // The startup probe, and nothing else. /api/chat used to be permitAll on
                        // the grounds that its replies are canned — but it is still a route that
                        // executes work on request, which guide §1/§4.1 puts behind a verified
                        // token like any other compute endpoint.
                        .requestMatchers("/healthz").permitAll()
                        // .access rather than .authenticated: this adds the trial check on top of
                        // authentication, so an authenticated user whose trial has lapsed gets 403
                        // while an anonymous caller still gets 401.
                        .anyRequest().access(new TrialAuthorizationManager()))
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> jwt.decoder(jwtDecoder)));
        return http.build();
    }
}

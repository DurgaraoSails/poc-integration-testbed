package com.sails.poc.testbed.config;

import java.time.Duration;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;

import com.sails.poc.testbed.security.ClaimEqualsValidator;
import com.sails.poc.testbed.security.PocAudienceValidator;

/**
 * This is the whole "verify the JWT" feature. self-service-api mints a POC-scoped token (see its
 * {@code PocLaunchService}); this fetches self-service-api's public signing keys from
 * {@code GET /.well-known/jwks.json} and checks every incoming {@code Authorization: Bearer <jwt>}
 * against them, exactly the way a real Spring OAuth2 resource server would.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public JwtDecoder jwtDecoder(PocProperties props) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(props.jwksUri()).build();

        OAuth2TokenValidator<org.springframework.security.oauth2.jwt.Jwt> issuer =
                new ClaimEqualsValidator("iss", props.jwtIssuer());
        OAuth2TokenValidator<org.springframework.security.oauth2.jwt.Jwt> audience =
                new PocAudienceValidator(props.expectedAudience());
        // self-service-api's own bridge contract calls for ±60s clock skew on exp/nbf.
        OAuth2TokenValidator<org.springframework.security.oauth2.jwt.Jwt> timestamp =
                new JwtTimestampValidator(Duration.ofSeconds(60));

        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(issuer, audience, timestamp));
        return decoder;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, JwtDecoder jwtDecoder) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // Cloud Run's own startup probe, and the canned chatbot, need no session.
                        .requestMatchers("/healthz", "/api/chat").permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> jwt.decoder(jwtDecoder)));
        return http.build();
    }
}

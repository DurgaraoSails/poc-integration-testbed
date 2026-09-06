package com.sails.poc.testbed.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Values the platform injects at deploy time (see poc-platform-sdk's POC-CONTRACT.md §8), plus
 * the two this backend additionally needs to verify a JWT itself: the expected issuer, and the
 * slug used to build the expected {@code aud} claim ({@code poc:<slug>}).
 */
@ConfigurationProperties(prefix = "poc")
public record PocProperties(
        String slug,
        String platformApiUrl,
        String jwtIssuer
) {
    public String jwksUri() {
        return platformApiUrl + "/.well-known/jwks.json";
    }

    public String expectedAudience() {
        return "poc:" + slug;
    }
}

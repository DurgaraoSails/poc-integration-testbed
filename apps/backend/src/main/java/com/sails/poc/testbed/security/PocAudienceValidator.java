package com.sails.poc.testbed.security;

import java.util.List;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * self-service-api mints POC-scoped launch tokens with {@code aud: ["poc:<slug>"]} (see
 * {@code PocAudience} in self-service-api). A token minted for a different POC must be rejected
 * here — the expected slug comes from this container's own config ({@code POC_SLUG}), never from
 * the token itself, exactly as the platform's own bridge contract specifies.
 */
public class PocAudienceValidator implements OAuth2TokenValidator<Jwt> {

    private final String expectedAudience;

    public PocAudienceValidator(String expectedAudience) {
        this.expectedAudience = expectedAudience;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt token) {
        List<String> audience = token.getAudience();
        if (audience != null && audience.contains(expectedAudience)) {
            return OAuth2TokenValidatorResult.success();
        }
        OAuth2Error error = new OAuth2Error(
                "invalid_token",
                "Token audience %s does not contain expected '%s'".formatted(audience, expectedAudience),
                null);
        return OAuth2TokenValidatorResult.failure(error);
    }
}

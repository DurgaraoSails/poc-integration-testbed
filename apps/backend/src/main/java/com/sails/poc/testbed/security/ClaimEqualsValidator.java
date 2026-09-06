package com.sails.poc.testbed.security;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Checks a string claim by exact match against the raw claim value.
 *
 * <p>Deliberately does NOT use Spring Security's built-in {@code JwtIssuerValidator}: that
 * validator calls {@link Jwt#getIssuer()}, which tries to parse the {@code iss} claim as a
 * {@link java.net.URL} — self-service-api's issuer is the plain string {@code self-service-api}
 * (see {@code jwt.issuer} in its config), not a URL, so that conversion is fragile here. Reading
 * the claim as a string with {@link Jwt#getClaimAsString(String)} sidesteps it entirely.
 */
public class ClaimEqualsValidator implements OAuth2TokenValidator<Jwt> {

    private final String claim;
    private final String expected;

    public ClaimEqualsValidator(String claim, String expected) {
        this.claim = claim;
        this.expected = expected;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt token) {
        if (expected.equals(token.getClaimAsString(claim))) {
            return OAuth2TokenValidatorResult.success();
        }
        OAuth2Error error = new OAuth2Error(
                "invalid_token",
                "Required claim '%s' was '%s', expected '%s'".formatted(claim, token.getClaimAsString(claim), expected),
                null);
        return OAuth2TokenValidatorResult.failure(error);
    }
}

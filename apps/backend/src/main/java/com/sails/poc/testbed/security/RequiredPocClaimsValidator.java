package com.sails.poc.testbed.security;

import java.math.BigDecimal;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Requires the claims this POC actually relies on to be present and of the right type.
 *
 * {@link org.springframework.security.oauth2.jwt.JwtTimestampValidator} checks {@code exp} against
 * the clock but treats an <em>absent</em> {@code exp} as valid — a token with no expiry sails
 * through it. The integration guide §4.6 requires a valid {@code exp} and a nonempty {@code sub},
 * and §4.7 requires the POC claim types to be validated, "including a positive integral
 * {@code pocId}".
 *
 * {@code pocId} matters because it is the platform's stable identifier for this POC in file
 * storage. It is not used to make an authorization decision here — the audience check does that —
 * but a token carrying a malformed one is malformed, and failing closed on it is cheaper than
 * discovering the type confusion further downstream.
 *
 * Deliberately not checked: {@code email}, {@code roles}, {@code tenantId}. POC tokens carry none
 * of them (guide §4), so requiring them would reject every real token.
 */
public class RequiredPocClaimsValidator implements OAuth2TokenValidator<Jwt> {

    @Override
    public OAuth2TokenValidatorResult validate(Jwt token) {
        if (token.getExpiresAt() == null) {
            return failure("Token has no 'exp' claim; a POC token must expire.");
        }

        String subject = token.getSubject();
        if (subject == null || subject.isBlank()) {
            return failure("Token has no usable 'sub' claim; there is no user to act as.");
        }

        Object pocId = token.getClaims().get("pocId");
        if (pocId == null) {
            return failure("Token has no 'pocId' claim.");
        }
        if (!isPositiveIntegral(pocId)) {
            return failure("Token claim 'pocId' must be a positive whole number, but was '%s' (%s)."
                    .formatted(pocId, pocId.getClass().getSimpleName()));
        }

        return OAuth2TokenValidatorResult.success();
    }

    /**
     * JSON has one number type, so a parser may hand back an Integer, a Long, or — for a value
     * written as {@code 42.0} — a Double or BigDecimal. Accept any of them that denotes a positive
     * whole number, and reject a fractional value rather than silently truncating it.
     */
    private static boolean isPositiveIntegral(Object value) {
        return switch (value) {
            case Integer i -> i > 0;
            case Long l -> l > 0;
            case Short s -> s > 0;
            case java.math.BigInteger b -> b.signum() > 0;
            case Double d -> d > 0 && d == Math.floor(d) && !d.isInfinite();
            case Float f -> f > 0 && f == Math.floor(f) && !f.isInfinite();
            case BigDecimal b -> b.signum() > 0 && b.stripTrailingZeros().scale() <= 0;
            default -> false;
        };
    }

    private static OAuth2TokenValidatorResult failure(String description) {
        return OAuth2TokenValidatorResult.failure(
                new OAuth2Error("invalid_token", description, null));
    }
}

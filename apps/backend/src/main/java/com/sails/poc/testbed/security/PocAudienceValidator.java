package com.sails.poc.testbed.security;

import java.util.List;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Requires the token to carry this POC's audience, and only this POC's audience.
 *
 * The expected value comes from this container's own {@code POC_SLUG}, never from the token.
 *
 * The previous implementation asked whether the audience list <em>contained</em> the expected
 * value, which accepts {@code aud: ["poc:this-poc", "poc:another-poc"]}. The integration guide
 * §4.5 rules that out explicitly — "reject ambiguous multiple-POC audience values" — because a
 * token valid at two POCs at once makes "which POC was this minted for" unanswerable, and the
 * platform's issued contract carries exactly one POC audience anyway. Anything else is not a
 * token this POC should be reasoning about.
 *
 * A JWT library may expose {@code aud} as a bare string or a list; {@link Jwt#getAudience()}
 * normalizes both to a list, so a single-element list is the shape both forms arrive in.
 */
public class PocAudienceValidator implements OAuth2TokenValidator<Jwt> {

    private final String expectedAudience;

    public PocAudienceValidator(String expectedAudience) {
        this.expectedAudience = expectedAudience;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt token) {
        List<String> audience = token.getAudience();

        if (audience == null || audience.isEmpty()) {
            return failure("Token carries no audience; expected exactly '%s'.".formatted(expectedAudience));
        }
        if (audience.size() > 1) {
            return failure(("Token carries %d audiences %s; a POC token must carry exactly one. "
                    + "Refusing to treat an ambiguous audience as '%s'.")
                    .formatted(audience.size(), audience, expectedAudience));
        }
        if (!expectedAudience.equals(audience.getFirst())) {
            return failure("Token audience '%s' is not this POC's audience '%s'."
                    .formatted(audience.getFirst(), expectedAudience));
        }
        return OAuth2TokenValidatorResult.success();
    }

    private static OAuth2TokenValidatorResult failure(String description) {
        return OAuth2TokenValidatorResult.failure(
                new OAuth2Error("invalid_token", description, null));
    }
}

package com.sails.poc.testbed.security;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Date;
import java.util.function.Supplier;

import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.authorization.AuthorizationResult;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;

/**
 * Denies protected work once a user's trial has ended.
 *
 * Deliberately an {@link AuthorizationManager} rather than another token validator. A failed
 * validator makes the token invalid, which Spring answers with {@code 401} — but the token
 * <em>is</em> valid here, and its holder <em>is</em> authenticated; what has run out is their
 * entitlement. The integration guide §4 draws exactly that line: "401 for invalid/missing/expired
 * credentials, 403 for an authenticated user whose trial or business authorization disallows the
 * action". Running as an authorization decision also means an unauthenticated request still gets
 * 401, because Spring's exception translation sends anonymous denials to the entry point.
 *
 * Three cases, per §4.8:
 * <ul>
 *   <li>claim absent — no claim-based trial restriction. Granted. Absence is not an error, and it
 *       is emphatically not a grant of extra privilege.</li>
 *   <li>claim present and in the past — denied, even when the JWT's own {@code exp} is later.</li>
 *   <li>claim present and malformed — denied. Fail closed: an unreadable deadline is not an
 *       absent one.</li>
 * </ul>
 */
public class TrialAuthorizationManager implements AuthorizationManager<RequestAuthorizationContext> {

    static final String CLAIM = "trialEndDate";

    private static final AuthorizationDecision GRANT = new AuthorizationDecision(true);
    private static final AuthorizationDecision DENY = new AuthorizationDecision(false);

    @Override
    public AuthorizationResult authorize(
            Supplier<? extends Authentication> authentication, RequestAuthorizationContext context) {

        Authentication auth = authentication.get();
        if (auth == null || !auth.isAuthenticated() || !(auth.getPrincipal() instanceof Jwt jwt)) {
            // Anonymous or non-JWT: denied here, and translated to a 401 rather than a 403 because
            // the request never carried a credential to begin with.
            return DENY;
        }

        Object claim = jwt.getClaims().get(CLAIM);
        if (claim == null) {
            return GRANT;
        }

        Instant trialEnd = toInstant(claim);
        if (trialEnd == null) {
            return DENY;
        }
        return Instant.now().isBefore(trialEnd) ? GRANT : DENY;
    }

    /**
     * {@code trialEndDate} is a JWT NumericDate — seconds since the epoch, not milliseconds. Spring
     * converts the registered date claims for us but leaves this one as whatever the JSON parser
     * produced, so accept the numeric forms it can take, plus the instant types in case a future
     * claim-set converter maps it. Anything else returns null and the caller fails closed.
     */
    private static Instant toInstant(Object value) {
        return switch (value) {
            case Instant instant -> instant;
            case Date date -> date.toInstant();
            case Integer i -> Instant.ofEpochSecond(i);
            case Long l -> Instant.ofEpochSecond(l);
            case Double d -> d.isNaN() || d.isInfinite() ? null : Instant.ofEpochSecond(d.longValue());
            case BigDecimal b -> Instant.ofEpochSecond(b.longValue());
            default -> null;
        };
    }
}

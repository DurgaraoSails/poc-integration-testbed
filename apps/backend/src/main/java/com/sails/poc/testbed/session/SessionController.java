package com.sails.poc.testbed.session;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * If this returns 200, the resource-server filter chain already verified the token's RS256
 * signature against the platform's JWKS, its issuer, its single POC audience, its required claims
 * and its expiry, and the trial check already allowed the request (see
 * {@link com.sails.poc.testbed.config.SecurityConfig}). This just reports what was found.
 *
 * A 401 means one of the token checks failed; a 403 means the token was fine but the trial has
 * ended. Either way Spring answered before this method would run.
 *
 * Reports named fields rather than echoing the whole claim set back. The browser holds the token
 * and could decode it itself, so this is not a secrecy boundary — but an endpoint that reflects
 * whatever it was given grows into one the moment a claim it did not anticipate starts arriving.
 */
@RestController
public class SessionController {

    @GetMapping("/api/session/whoami")
    public Map<String, Object> whoami(@AuthenticationPrincipal Jwt jwt) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("verified", true);
        body.put("subject", jwt.getSubject());
        body.put("audience", jwt.getAudience());
        body.put("issuer", jwt.getClaimAsString("iss"));
        body.put("pocId", jwt.getClaims().get("pocId"));
        body.put("expiresAt", jwt.getExpiresAt());
        return body;
    }
}

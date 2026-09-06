package com.sails.poc.testbed.session;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * If this returns 200, Spring Security's resource-server filter chain already verified the
 * token's RS256 signature against self-service-api's JWKS, its issuer, its audience
 * ({@code poc:<slug>}), and its expiry (see {@link com.sails.poc.testbed.config.SecurityConfig}) —
 * this controller just reports what was found. A 401 here means one of those checks failed;
 * Spring Security's default entry point already sent it before this method would run.
 */
@RestController
public class SessionController {

    @GetMapping("/api/session/whoami")
    public Map<String, Object> whoami(Jwt jwt) {
        Map<String, Object> claims = new LinkedHashMap<>(jwt.getClaims());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("verified", true);
        body.put("subject", jwt.getSubject());
        body.put("audience", jwt.getAudience());
        body.put("issuer", jwt.getClaimAsString("iss"));
        body.put("expiresAt", jwt.getExpiresAt());
        body.put("claims", claims);
        return body;
    }
}

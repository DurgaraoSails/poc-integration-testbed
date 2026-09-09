package com.sails.poc.testbed.security;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AuthenticationServiceException;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Turns "we could not reach the key service" into a bounded 503.
 *
 * When the JWKS endpoint is unreachable, Spring Security raises an
 * {@link AuthenticationServiceException} and — deliberately — does <em>not</em> route it to the
 * bearer-token entry point, because a server-side failure is not a client credential problem. Left
 * alone it escapes the filter chain as a 500 with a stack trace.
 *
 * Neither answer is wrong about access: the request is denied either way, which is the property
 * that actually matters (integration guide §4 — never accept an unverified token during a JWKS
 * outage). But the guide also allows the outage to "be reported as a bounded service error", and
 * 503 says what happened: the credential was not rejected, it could not be checked. A 401 here
 * would be a lie that sends a POC author hunting for a bad token, and a caller that retries a 401
 * by renewing would burn a token replacing one that was never the problem.
 *
 * Ordered ahead of the security filter chain so it wraps it.
 */
public class VerificationOutageFilter implements Filter {

    /** Ahead of Spring Security's own chain, whose default registration order is -100. */
    public static final int ORDER = -200;

    private static final byte[] BODY =
            "{\"error\":\"token verification is temporarily unavailable\"}".getBytes(StandardCharsets.UTF_8);

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        try {
            chain.doFilter(request, response);
        } catch (AuthenticationServiceException e) {
            HttpServletResponse http = (HttpServletResponse) response;
            if (http.isCommitted()) {
                throw e;
            }
            http.resetBuffer();
            http.setStatus(HttpStatus.SERVICE_UNAVAILABLE.value());
            http.setContentType(MediaType.APPLICATION_JSON_VALUE);
            // Nothing about the failure is cacheable, and nothing about it is the client's fault.
            http.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
            http.getOutputStream().write(BODY);
        }
    }
}

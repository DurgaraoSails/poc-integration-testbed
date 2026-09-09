package com.sails.poc.testbed.config;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Set;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Runtime configuration, validated at startup.
 *
 * The platform injects {@code POC_SLUG} and {@code PLATFORM_API_URL}. It does <em>not</em> inject
 * an expected JWT issuer — that gap is called out in the integration guide §3, which asks each POC
 * to define its own setting and have the platform contact confirm the value. Hence
 * {@code POC_EXPECTED_ISSUER}, supplied as a non-secret literal in {@code poc.yaml}'s {@code env}
 * block. It was previously {@code JWT_ISSUER} with a silent default, which read like a platform
 * variable and was not one.
 *
 * Every value is required and checked here rather than defaulted. A backend that quietly falls
 * back to {@code http://localhost:8080} for the platform API does not fail — it starts up and then
 * rejects every token, or worse, fetches keys from whatever happens to answer on that port inside
 * its own container network. Guide §3: validate at startup, and reject malformed configuration.
 */
@ConfigurationProperties(prefix = "poc")
public record PocProperties(
        String slug,
        String platformApiUrl,
        String expectedIssuer,
        /**
         * Permits a plaintext {@code platformApiUrl} against a loopback host. Off by default, so a
         * deployment cannot end up fetching signing keys over http without someone having said so;
         * `application-local.yaml` turns it on for docker-compose.
         */
        boolean allowInsecurePlatformUrl) {

    /** Hosts an http:// platform URL is tolerated for, when explicitly allowed. */
    private static final Set<String> LOCAL_HOSTS =
            Set.of("localhost", "127.0.0.1", "[::1]", "host.docker.internal", "backend");

    public PocProperties {
        slug = required("poc.slug (POC_SLUG)", slug);
        expectedIssuer = required("poc.expected-issuer (POC_EXPECTED_ISSUER)", expectedIssuer);
        platformApiUrl = validatePlatformApiUrl(
                required("poc.platform-api-url (PLATFORM_API_URL)", platformApiUrl),
                allowInsecurePlatformUrl);
    }

    /** The only place signing keys are ever fetched from. Never a location named by a token. */
    public String jwksUri() {
        return platformApiUrl + "/.well-known/jwks.json";
    }

    /** Built from trusted configuration, never from an incoming token's own claims. */
    public String expectedAudience() {
        return "poc:" + slug;
    }

    private static String required(String name, String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(
                    name + " is required and was not set. This POC will not start without it.");
        }
        return value.trim();
    }

    private static String validatePlatformApiUrl(String value, boolean allowInsecure) {
        String normalized = value.endsWith("/") ? value.substring(0, value.length() - 1) : value;

        URI uri;
        try {
            uri = new URI(normalized);
        } catch (URISyntaxException e) {
            throw new IllegalStateException(
                    "poc.platform-api-url (PLATFORM_API_URL) is not a valid URL: " + value, e);
        }

        if (uri.getHost() == null || uri.getScheme() == null) {
            throw new IllegalStateException(
                    "poc.platform-api-url (PLATFORM_API_URL) must be an absolute URL such as "
                            + "https://platform-api.example.com, but was: " + value);
        }
        if (uri.getQuery() != null || uri.getFragment() != null) {
            throw new IllegalStateException(
                    "poc.platform-api-url (PLATFORM_API_URL) must be a base URL with no query or "
                            + "fragment, but was: " + value);
        }

        boolean https = "https".equalsIgnoreCase(uri.getScheme());
        if (!https) {
            boolean tolerated = allowInsecure
                    && "http".equalsIgnoreCase(uri.getScheme())
                    && LOCAL_HOSTS.contains(uri.getHost().toLowerCase());
            if (!tolerated) {
                throw new IllegalStateException(
                        "poc.platform-api-url (PLATFORM_API_URL) must use https, but was: " + value
                                + ". Signing keys are fetched from this URL; set "
                                + "poc.allow-insecure-platform-url=true only for local development "
                                + "against a loopback host.");
            }
        }
        return normalized;
    }
}

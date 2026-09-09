package com.sails.poc.testbed.config;

import java.time.Duration;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;

/**
 * The HTTP client this backend uses to call the platform on a user's behalf.
 *
 * A bean rather than a {@code new} inside the controller so that the timeouts live in one place
 * and so tests can substitute the transport without substituting the controller — the forwarding
 * behaviour that matters (which token goes out, which parameters do not) is exactly what needs to
 * stay real under test.
 */
@Configuration
public class PlatformApiConfig {

    /** A file upload or download is slower than a JSON call, but must still not hang forever. */
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(30);

    @Bean
    public ClientHttpRequestFactory platformApiRequestFactory() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(CONNECT_TIMEOUT);
        factory.setReadTimeout(READ_TIMEOUT);
        return factory;
    }
}

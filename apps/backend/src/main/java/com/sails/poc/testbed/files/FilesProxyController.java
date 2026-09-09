package com.sails.poc.testbed.files;

import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.util.UriComponentsBuilder;

import com.sails.poc.testbed.config.PocProperties;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;

/**
 * Proxies to the platform's POC-facing file endpoints ({@code /poc-files}), forwarding the same
 * POC-scoped JWT this backend just verified. The platform re-derives the user and the POC from
 * that token's claims, so isolation between users and between POCs is enforced there — which is
 * also why these routes take no user or POC parameter, and why one must never be added.
 *
 * The platform API is an explicitly trusted destination configured at startup, not a URL taken
 * from a request. Forwarding the caller's token anywhere else would be a credential leak.
 *
 * Kept behind this backend rather than called from the browser so the frontend never needs the
 * platform to allow cross-origin requests from every deployed POC's own origin.
 */
@RestController
@RequestMapping("/api/files")
public class FilesProxyController {

    /**
     * Response headers worth passing back to the browser. Everything else is dropped, in
     * particular the hop-by-hop headers and the framing ones: relaying an upstream
     * {@code Content-Length} or {@code Transfer-Encoding} alongside a body this container has
     * already buffered and re-encodes is how a proxy ends up describing a response it is not
     * actually sending.
     */
    private static final Set<String> RELAYED_HEADERS = Set.of(
            HttpHeaders.CONTENT_TYPE.toLowerCase(),
            HttpHeaders.CONTENT_DISPOSITION.toLowerCase());

    private final RestClient platformApi;

    public FilesProxyController(PocProperties props, ClientHttpRequestFactory platformApiRequestFactory) {
        this.platformApi = RestClient.builder()
                .baseUrl(props.platformApiUrl())
                .requestFactory(platformApiRequestFactory)
                .build();
    }

    @PostMapping
    public ResponseEntity<byte[]> upload(@RequestParam("file") MultipartFile file, @AuthenticationPrincipal Jwt jwt) throws IOException {
        var body = new LinkedMultiValueMap<String, Object>();
        // Exactly the field name the platform expects.
        body.add("file", new ByteArrayResource(file.getBytes()) {
            @Override
            public String getFilename() {
                return file.getOriginalFilename();
            }
        });
        return forward(() -> platformApi.post()
                .uri("/poc-files")
                .header(HttpHeaders.AUTHORIZATION, bearer(jwt))
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .body(body)
                .retrieve()
                .toEntity(byte[].class));
    }

    @GetMapping
    public ResponseEntity<byte[]> list(@AuthenticationPrincipal Jwt jwt) {
        return forward(() -> platformApi.get()
                .uri("/poc-files")
                .header(HttpHeaders.AUTHORIZATION, bearer(jwt))
                .retrieve()
                .toEntity(byte[].class));
    }

    @GetMapping("/{fileId}/content")
    public ResponseEntity<byte[]> content(@PathVariable long fileId, @AuthenticationPrincipal Jwt jwt) {
        return forward(() -> platformApi.get()
                .uri(UriComponentsBuilder.fromPath("/poc-files/{fileId}/content").build(fileId))
                .header(HttpHeaders.AUTHORIZATION, bearer(jwt))
                .retrieve()
                .toEntity(byte[].class));
    }

    @DeleteMapping("/{fileId}")
    public ResponseEntity<byte[]> delete(@PathVariable long fileId, @AuthenticationPrincipal Jwt jwt) {
        return forward(() -> platformApi.delete()
                .uri(UriComponentsBuilder.fromPath("/poc-files/{fileId}").build(fileId))
                .header(HttpHeaders.AUTHORIZATION, bearer(jwt))
                .retrieve()
                .toEntity(byte[].class));
    }

    private static String bearer(Jwt jwt) {
        return "Bearer " + jwt.getTokenValue();
    }

    /**
     * The platform distinguishes 400 (validation/type), 403 (trial/access), 404 (missing or not
     * yours), 409 (quota) and 413 (too large), and the frontend turns each into its own message —
     * so its status and body are relayed rather than collapsed into a 500.
     */
    private ResponseEntity<byte[]> forward(Supplier<ResponseEntity<byte[]>> call) {
        try {
            ResponseEntity<byte[]> upstream = call.get();
            return relay(upstream.getStatusCode().value(), upstream.getHeaders(), upstream.getBody());
        } catch (RestClientResponseException e) {
            return relay(e.getStatusCode().value(), e.getResponseHeaders(), e.getResponseBodyAsByteArray());
        } catch (Exception e) {
            // A bounded service error, never a fallback that lets the operation appear to succeed.
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"error\":\"could not reach the platform file service\"}"
                            .getBytes(StandardCharsets.UTF_8));
        }
    }

    private static ResponseEntity<byte[]> relay(int status, HttpHeaders upstream, byte[] body) {
        return ResponseEntity.status(status)
                .headers(headers -> {
                    if (upstream == null) {
                        return;
                    }
                    upstream.forEach((name, values) -> {
                        if (RELAYED_HEADERS.contains(name.toLowerCase())) {
                            headers.put(name, List.copyOf(values));
                        }
                    });
                })
                .body(body);
    }
}

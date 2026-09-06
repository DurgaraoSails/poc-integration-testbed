package com.sails.poc.testbed.files;

import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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
import java.util.function.Supplier;

/**
 * Proxies to self-service-api's POC-facing file endpoints (/poc-files/*), forwarding the same
 * POC-scoped JWT this backend just verified as the Authorization bearer token — self-service-api
 * re-derives the user and the POC from that token's claims, so isolation between users and
 * between POCs is enforced there, not here (see docs/specs/file-management.md in self-service-api).
 *
 * <p>Kept behind this backend rather than called directly from the browser so the frontend never
 * needs self-service-api to allow cross-origin requests from every deployed POC's own origin.
 */
@RestController
@RequestMapping("/api/files")
public class FilesProxyController {

    private final RestClient selfServiceApi;

    public FilesProxyController(PocProperties props) {
        this.selfServiceApi = RestClient.builder().baseUrl(props.platformApiUrl()).build();
    }

    @PostMapping
    public ResponseEntity<byte[]> upload(@RequestParam("file") MultipartFile file, Jwt jwt) throws IOException {
        var body = new LinkedMultiValueMap<String, Object>();
        body.add("file", new ByteArrayResource(file.getBytes()) {
            @Override
            public String getFilename() {
                return file.getOriginalFilename();
            }
        });
        return forward(() -> selfServiceApi.post()
                .uri("/poc-files")
                .header(HttpHeaders.AUTHORIZATION, bearer(jwt))
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .body(body)
                .retrieve()
                .toEntity(byte[].class));
    }

    @GetMapping
    public ResponseEntity<byte[]> list(Jwt jwt) {
        return forward(() -> selfServiceApi.get()
                .uri("/poc-files")
                .header(HttpHeaders.AUTHORIZATION, bearer(jwt))
                .retrieve()
                .toEntity(byte[].class));
    }

    @GetMapping("/{fileId}/content")
    public ResponseEntity<byte[]> content(@PathVariable long fileId, Jwt jwt) {
        return forward(() -> selfServiceApi.get()
                .uri(UriComponentsBuilder.fromPath("/poc-files/{fileId}/content").build(fileId))
                .header(HttpHeaders.AUTHORIZATION, bearer(jwt))
                .retrieve()
                .toEntity(byte[].class));
    }

    @DeleteMapping("/{fileId}")
    public ResponseEntity<byte[]> delete(@PathVariable long fileId, Jwt jwt) {
        return forward(() -> selfServiceApi.delete()
                .uri(UriComponentsBuilder.fromPath("/poc-files/{fileId}").build(fileId))
                .header(HttpHeaders.AUTHORIZATION, bearer(jwt))
                .retrieve()
                .toEntity(byte[].class));
    }

    private static String bearer(Jwt jwt) {
        return "Bearer " + jwt.getTokenValue();
    }

    /** self-service-api's own status code and error body are more useful to see while testing
     *  this integration than a generic 500, so pass both straight through on failure. */
    private ResponseEntity<byte[]> forward(Supplier<ResponseEntity<byte[]>> call) {
        try {
            return call.get();
        } catch (RestClientResponseException e) {
            return ResponseEntity.status(e.getStatusCode())
                    .headers(headers -> {
                        if (e.getResponseHeaders() != null) {
                            headers.putAll(e.getResponseHeaders());
                        }
                    })
                    .body(e.getResponseBodyAsByteArray());
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(("{\"error\":\"could not reach self-service-api: " + e.getMessage() + "\"}")
                            .getBytes(StandardCharsets.UTF_8));
        }
    }
}

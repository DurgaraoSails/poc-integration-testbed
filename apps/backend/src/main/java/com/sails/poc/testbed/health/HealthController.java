package com.sails.poc.testbed.health;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Cloud Run's per-container startup probe hits this directly; it never passes through the
 *  platform proxy, which is why this container sets no context-path. */
@RestController
public class HealthController {

    @GetMapping(value = "/healthz", produces = MediaType.TEXT_PLAIN_VALUE)
    public String healthz() {
        return "ok";
    }
}

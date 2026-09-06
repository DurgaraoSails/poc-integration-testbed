package com.sails.poc.testbed.chat;

import java.util.List;
import java.util.Locale;

import org.springframework.stereotype.Service;

/**
 * Static, predefined answers only — this is a test fixture for exercising the deploy pipeline
 * and the platform integrations around it, not a real chatbot. No LLM call, no external service.
 */
@Service
public class ChatService {

    private record Rule(List<String> keywords, String reply) {
        boolean matches(String message) {
            return keywords.stream().anyMatch(message::contains);
        }
    }

    private final List<Rule> rules = List.of(
            new Rule(List.of("hello", "hi", "hey"),
                    "Hello! I'm the sample testbed bot. Ask me about files, auth, or this POC."),
            new Rule(List.of("file", "upload", "download"),
                    "Use the Files panel above: uploads go through this backend to " +
                            "self-service-api's /poc-files endpoints, scoped to your user and this POC."),
            new Rule(List.of("auth", "token", "jwt", "login", "sign in"),
                    "Use the Auth panel above: it fetches your POC-scoped JWT and this backend " +
                            "verifies it against self-service-api's /.well-known/jwks.json."),
            new Rule(List.of("who are you", "what are you", "what is this"),
                    "I'm a static test fixture inside poc-integration-testbed, used to exercise " +
                            "POC authentication, isolated file storage, and the ingress/sidecar deploy pipeline."),
            new Rule(List.of("help"),
                    "Try: \"how do files work\", \"what about auth\", or just say hello.")
    );

    private static final String FALLBACK =
            "I only know a few canned answers — try asking about \"files\", \"auth\", or say \"hello\".";

    public String reply(String message) {
        String normalized = message == null ? "" : message.toLowerCase(Locale.ROOT);
        return rules.stream()
                .filter(rule -> rule.matches(normalized))
                .findFirst()
                .map(Rule::reply)
                .orElse(FALLBACK);
    }
}

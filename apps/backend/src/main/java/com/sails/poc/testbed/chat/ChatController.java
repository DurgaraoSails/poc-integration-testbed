package com.sails.poc.testbed.chat;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ChatController {

    private final ChatService chatService;

    public ChatController(ChatService chatService) {
        this.chatService = chatService;
    }

    public record ChatRequest(String message) {
    }

    public record ChatResponse(String reply) {
    }

    /** Public on purpose (see SecurityConfig) — the chatbot is a static demo, not a protected
     *  feature, so it works even before you've fetched a session token. */
    @PostMapping("/api/chat")
    public ChatResponse chat(@RequestBody(required = false) ChatRequest request) {
        String message = request != null ? request.message() : null;
        return new ChatResponse(chatService.reply(message));
    }
}

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

    /**
     * Authenticated, like every other route but /healthz. The replies are canned, but this is
     * still a route that executes work on request — guide §1/§4.1 puts those behind a verified
     * token regardless of what the work costs today, and the moment this bot is wired to a model
     * the cost stops being zero.
     */
    @PostMapping("/api/chat")
    public ChatResponse chat(@RequestBody(required = false) ChatRequest request) {
        String message = request != null ? request.message() : null;
        return new ChatResponse(chatService.reply(message));
    }
}

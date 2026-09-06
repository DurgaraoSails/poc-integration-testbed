package com.sails.poc.testbed;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class TestbedApplication {

    public static void main(String[] args) {
        SpringApplication.run(TestbedApplication.class, args);
    }
}

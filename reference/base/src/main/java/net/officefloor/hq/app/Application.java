package net.officefloor.hq.app;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Spring Boot 4 host. OfficeFloor REST is added by the officefloor-rest-spring-boot-4-starter on
 * the classpath; domain endpoints are declared as additive OfficeFloor YAML under
 * src/main/resources/officefloor/rest/*.GET.yml (each -> a logic class with a service(...) method).
 * Spring serves the SPA (static/), H2 + Flyway + Actuator.
 *
 * At the base this is a bare shell; checkpoints add migrations, officefloor/rest routes + logic,
 * @Service beans, and front-end features.
 */
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}

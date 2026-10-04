package net.officefloor.hq.app;

import java.io.IOException;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

/**
 * Serve the SPA from static/ with a deep-link fallback: an unknown, non-API path returns
 * index.html so a browser refresh on a client route works. OfficeFloor REST routes and Spring
 * endpoints are matched first; only unmatched, non-{@code api/} paths fall through to the SPA.
 * TODO: confirm the API path prefix used by the OfficeFloor routes ("api/" assumed here).
 */
@Configuration
public class SpaConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/")
                .resourceChain(true)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(String resourcePath, Resource location) throws IOException {
                        if (resourcePath.startsWith("api/")) {
                            return null; // let the API handle / 404 it
                        }
                        Resource requested = location.createRelative(resourcePath);
                        return (requested.exists() && requested.isReadable())
                                ? requested
                                : location.createRelative("index.html");
                    }
                });
    }
}

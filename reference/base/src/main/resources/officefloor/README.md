# OfficeFloor REST wiring

Domain REST endpoints are declared here as **additive OfficeFloor YAML**, served by the
officefloor-rest-spring-boot-4-starter inside the Spring Boot host. Put them under `rest/api/` so
their paths start with `/api/` — `SpaConfig` only bypasses the SPA deep-link fallback for `/api/*`
(a non-`/api/` route returns the SPA HTML instead of your endpoint). Directory nesting maps to path
segments, so `rest/api/owners.GET.yml` → `GET /api/owners`. Each route is its own file:

```
# officefloor/rest/api/<path>.GET.yml   (or .POST.yml, {param}.GET.yml, ...)
service:
  class: net.officefloor.hq.app.<SomeLogic>   # a class with a service(...) method
```

The logic class's `service(...)` method takes injected dependencies (Spring @Service beans, the
data layer) and a `net.officefloor.web.ObjectResponse<T>` to send the response — verified shape:
OfficeFloor tutorial SpringRestGettingStartedHttpServer.

This directory is a **shared surface** (`config.yaml → app.shared_surfaces.backend`): the additive
ideal is a **new .yml + a new logic class per endpoint**, never growing a central file — a
checkpoint forced to edit shared wiring scores a boundary violation (DESIGN.md §8).

The base has no domain routes; cp01 onward add them. (The `/__test__` seed endpoint and readiness
`/actuator/health` are Spring-side — a @RestController and Actuator — not OfficeFloor routes.)

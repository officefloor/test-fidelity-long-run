                // archived is optional; default to false (active, matching Flyway V18) when absent.
                Object archived = client.get("archived");
                // Explicit fixture id (JPA save() would ignore it on an IDENTITY column).
                jdbc.update("INSERT INTO clients (id, name, email, archived) VALUES (?, ?, ?, ?)",
                        ((Number) client.get("id")).longValue(), client.get("name"),
                        client.get("email"),
                        archived != null && Boolean.parseBoolean(archived.toString()));

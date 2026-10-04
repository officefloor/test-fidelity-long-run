                // archived is optional; default to false (matching Flyway V15) when absent.
                Object archived = project.get("archived");
                jdbc.update("INSERT INTO projects (id, name, client_id, archived)"
                        + " VALUES (?, ?, ?, ?)",
                        ((Number) project.get("id")).longValue(), project.get("name"),
                        ((Number) project.get("clientId")).longValue(),
                        archived != null && Boolean.parseBoolean(archived.toString()));

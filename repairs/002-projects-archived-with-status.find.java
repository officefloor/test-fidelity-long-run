                jdbc.update("INSERT INTO projects (id, name, client_id, status) VALUES (?, ?, ?, ?)",
                        ((Number) project.get("id")).longValue(), project.get("name"),
                        ((Number) project.get("clientId")).longValue(),
                        status != null ? status.toString() : "ACTIVE");

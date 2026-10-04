                jdbc.update("INSERT INTO projects (id, name, client_id) VALUES (?, ?, ?)",
                        ((Number) project.get("id")).longValue(), project.get("name"),
                        ((Number) project.get("clientId")).longValue());

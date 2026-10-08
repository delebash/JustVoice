// SPDX-License-Identifier: MIT
// Captured 2026-10-08 by the kit's capture-schema tool from Python's justvoice.database.models,
// and since then the schema itself (the Python is gone): each table's DDL is the exact text
// Python's create_all wrote to sqlite_master, so old and new databases match cell for cell;
// `columns` carries each column's conversion kind and default. Change a table here.
export const TABLES = [
  {
    "name": "personas",
    "ddl": "CREATE TABLE personas (\n\tid VARCHAR NOT NULL, \n\tname VARCHAR NOT NULL, \n\tlanguage VARCHAR, \n\tavatar_path VARCHAR, \n\tvoice_id VARCHAR, \n\tvoice_instruct TEXT, \n\tnote TEXT, \n\tdefault_delivery TEXT, \n\teffects_chain TEXT, \n\tlexicon_id VARCHAR, \n\timported_from VARCHAR, \n\timported_id VARCHAR, \n\tcreated_at DATETIME, \n\tupdated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(lexicon_id) REFERENCES lexicons (id) ON DELETE SET NULL\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "name": {
        "kind": "text",
        "notNull": true
      },
      "language": {
        "kind": "text",
        "default": "en"
      },
      "avatar_path": {
        "kind": "text"
      },
      "voice_id": {
        "kind": "text"
      },
      "voice_instruct": {
        "kind": "text"
      },
      "note": {
        "kind": "text"
      },
      "default_delivery": {
        "kind": "text"
      },
      "effects_chain": {
        "kind": "text"
      },
      "lexicon_id": {
        "kind": "text"
      },
      "imported_from": {
        "kind": "text"
      },
      "imported_id": {
        "kind": "text"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      },
      "updated_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow",
        "onupdateFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "lexicons",
    "ddl": "CREATE TABLE lexicons (\n\tid VARCHAR NOT NULL, \n\tname VARCHAR NOT NULL, \n\tdescription TEXT, \n\tscope VARCHAR NOT NULL, \n\tproject_id VARCHAR, \n\tpersona_id VARCHAR, \n\tcreated_at DATETIME, \n\tupdated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, \n\tFOREIGN KEY(persona_id) REFERENCES personas (id) ON DELETE CASCADE\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "name": {
        "kind": "text",
        "notNull": true
      },
      "description": {
        "kind": "text"
      },
      "scope": {
        "kind": "text",
        "notNull": true,
        "default": "global"
      },
      "project_id": {
        "kind": "text"
      },
      "persona_id": {
        "kind": "text"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      },
      "updated_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow",
        "onupdateFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "projects",
    "ddl": "CREATE TABLE projects (\n\tid VARCHAR NOT NULL, \n\tname VARCHAR NOT NULL, \n\tdescription TEXT, \n\tproject_type VARCHAR NOT NULL, \n\tmetadata_json TEXT, \n\tdefault_lexicon_id VARCHAR, \n\tmastering_preset VARCHAR, \n\timported_from VARCHAR, \n\timported_id VARCHAR, \n\tdiscover_ignored TEXT, \n\tcreated_at DATETIME, \n\tupdated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(default_lexicon_id) REFERENCES lexicons (id) ON DELETE SET NULL\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "name": {
        "kind": "text",
        "notNull": true
      },
      "description": {
        "kind": "text"
      },
      "project_type": {
        "kind": "text",
        "notNull": true
      },
      "metadata_json": {
        "kind": "text"
      },
      "default_lexicon_id": {
        "kind": "text"
      },
      "mastering_preset": {
        "kind": "text"
      },
      "imported_from": {
        "kind": "text"
      },
      "imported_id": {
        "kind": "text"
      },
      "discover_ignored": {
        "kind": "text"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      },
      "updated_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow",
        "onupdateFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "channels",
    "ddl": "CREATE TABLE channels (\n\tid VARCHAR NOT NULL, \n\tname VARCHAR NOT NULL, \n\tis_default BOOLEAN NOT NULL, \n\tdevice_ids_json TEXT NOT NULL, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (id), \n\tUNIQUE (name)\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "name": {
        "kind": "text",
        "notNull": true
      },
      "is_default": {
        "kind": "bool",
        "notNull": true,
        "default": false
      },
      "device_ids_json": {
        "kind": "text",
        "notNull": true,
        "default": "[]"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "captures",
    "ddl": "CREATE TABLE captures (\n\tid VARCHAR NOT NULL, \n\taudio_path VARCHAR NOT NULL, \n\tsource VARCHAR NOT NULL, \n\tlanguage VARCHAR, \n\tduration_ms INTEGER, \n\ttranscript TEXT, \n\traw_transcript TEXT, \n\trefinement_flags_json TEXT, \n\tpinned BOOLEAN NOT NULL, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (id)\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "audio_path": {
        "kind": "text",
        "notNull": true
      },
      "source": {
        "kind": "text",
        "notNull": true,
        "default": "mic"
      },
      "language": {
        "kind": "text"
      },
      "duration_ms": {
        "kind": "int"
      },
      "transcript": {
        "kind": "text"
      },
      "raw_transcript": {
        "kind": "text"
      },
      "refinement_flags_json": {
        "kind": "text"
      },
      "pinned": {
        "kind": "bool",
        "notNull": true,
        "default": false
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "effect_presets",
    "ddl": "CREATE TABLE effect_presets (\n\tid VARCHAR NOT NULL, \n\tname VARCHAR NOT NULL, \n\tdescription TEXT, \n\tchain_json TEXT NOT NULL, \n\tis_builtin BOOLEAN NOT NULL, \n\tsort_order INTEGER NOT NULL, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (id), \n\tUNIQUE (name)\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "name": {
        "kind": "text",
        "notNull": true
      },
      "description": {
        "kind": "text"
      },
      "chain_json": {
        "kind": "text",
        "notNull": true
      },
      "is_builtin": {
        "kind": "bool",
        "notNull": true,
        "default": false
      },
      "sort_order": {
        "kind": "int",
        "notNull": true,
        "default": 100
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "webhooks",
    "ddl": "CREATE TABLE webhooks (\n\tid VARCHAR NOT NULL, \n\turl VARCHAR NOT NULL, \n\tevents_json TEXT NOT NULL, \n\tsecret_hash VARCHAR NOT NULL, \n\tenabled BOOLEAN NOT NULL, \n\tlast_delivery_at DATETIME, \n\tlast_status_code INTEGER, \n\tlog_tail_json TEXT NOT NULL, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (id)\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "url": {
        "kind": "text",
        "notNull": true
      },
      "events_json": {
        "kind": "text",
        "notNull": true
      },
      "secret_hash": {
        "kind": "text",
        "notNull": true
      },
      "enabled": {
        "kind": "bool",
        "notNull": true,
        "default": true
      },
      "last_delivery_at": {
        "kind": "datetime"
      },
      "last_status_code": {
        "kind": "int"
      },
      "log_tail_json": {
        "kind": "text",
        "notNull": true,
        "default": "[]"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "prefs",
    "ddl": "CREATE TABLE prefs (\n\t\"key\" VARCHAR NOT NULL, \n\tvalue TEXT NOT NULL, \n\tPRIMARY KEY (\"key\")\n)",
    "indexes": [],
    "columns": {
      "key": {
        "kind": "text",
        "pk": true,
        "notNull": true
      },
      "value": {
        "kind": "text",
        "notNull": true,
        "default": "null"
      }
    }
  },
  {
    "name": "settings",
    "ddl": "CREATE TABLE settings (\n\tid VARCHAR NOT NULL, \n\tdata TEXT NOT NULL, \n\tPRIMARY KEY (id)\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "default": "singleton"
      },
      "data": {
        "kind": "text",
        "notNull": true,
        "default": "{}"
      }
    }
  },
  {
    "name": "persona_channels",
    "ddl": "CREATE TABLE persona_channels (\n\tpersona_id VARCHAR NOT NULL, \n\tchannel_id VARCHAR NOT NULL, \n\tPRIMARY KEY (persona_id, channel_id), \n\tFOREIGN KEY(persona_id) REFERENCES personas (id) ON DELETE CASCADE, \n\tFOREIGN KEY(channel_id) REFERENCES channels (id) ON DELETE CASCADE\n)",
    "indexes": [],
    "columns": {
      "persona_id": {
        "kind": "text",
        "pk": true,
        "notNull": true
      },
      "channel_id": {
        "kind": "text",
        "pk": true,
        "notNull": true
      }
    }
  },
  {
    "name": "lexicon_entries",
    "ddl": "CREATE TABLE lexicon_entries (\n\tid VARCHAR NOT NULL, \n\tlexicon_id VARCHAR NOT NULL, \n\tword VARCHAR NOT NULL, \n\tpronunciation TEXT NOT NULL, \n\tnotation VARCHAR NOT NULL, \n\tnotes TEXT, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(lexicon_id) REFERENCES lexicons (id) ON DELETE CASCADE\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "lexicon_id": {
        "kind": "text",
        "notNull": true
      },
      "word": {
        "kind": "text",
        "notNull": true
      },
      "pronunciation": {
        "kind": "text",
        "notNull": true
      },
      "notation": {
        "kind": "text",
        "notNull": true,
        "default": "phonetic"
      },
      "notes": {
        "kind": "text"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "speakers",
    "ddl": "CREATE TABLE speakers (\n\tid VARCHAR NOT NULL, \n\tproject_id VARCHAR NOT NULL, \n\tname VARCHAR NOT NULL, \n\taliases TEXT, \n\tdescription TEXT, \n\tpersona_id VARCHAR, \n\trole_label VARCHAR, \n\tpronouns VARCHAR, \n\timported_from VARCHAR, \n\timported_id VARCHAR, \n\tcreated_at DATETIME, \n\tupdated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, \n\tFOREIGN KEY(persona_id) REFERENCES personas (id) ON DELETE SET NULL\n)",
    "indexes": [
      "CREATE INDEX ix_speakers_project ON speakers (project_id)"
    ],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "project_id": {
        "kind": "text",
        "notNull": true
      },
      "name": {
        "kind": "text",
        "notNull": true
      },
      "aliases": {
        "kind": "text"
      },
      "description": {
        "kind": "text"
      },
      "persona_id": {
        "kind": "text"
      },
      "role_label": {
        "kind": "text"
      },
      "pronouns": {
        "kind": "text"
      },
      "imported_from": {
        "kind": "text"
      },
      "imported_id": {
        "kind": "text"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      },
      "updated_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow",
        "onupdateFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "scenes",
    "ddl": "CREATE TABLE scenes (\n\tid VARCHAR NOT NULL, \n\tproject_id VARCHAR NOT NULL, \n\tposition INTEGER NOT NULL, \n\ttitle VARCHAR, \n\tdescription TEXT, \n\tmetadata_json TEXT, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "project_id": {
        "kind": "text",
        "notNull": true
      },
      "position": {
        "kind": "int",
        "notNull": true
      },
      "title": {
        "kind": "text"
      },
      "description": {
        "kind": "text"
      },
      "metadata_json": {
        "kind": "text"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "render_jobs",
    "ddl": "CREATE TABLE render_jobs (\n\tid VARCHAR NOT NULL, \n\tproject_id VARCHAR NOT NULL, \n\tscope VARCHAR NOT NULL, \n\tscope_ids_json TEXT, \n\tstatus VARCHAR NOT NULL, \n\ttotal_blocks INTEGER, \n\tcompleted_blocks INTEGER NOT NULL, \n\tfailed_blocks INTEGER NOT NULL, \n\tstarted_at DATETIME, \n\tfinished_at DATETIME, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "project_id": {
        "kind": "text",
        "notNull": true
      },
      "scope": {
        "kind": "text",
        "notNull": true
      },
      "scope_ids_json": {
        "kind": "text"
      },
      "status": {
        "kind": "text",
        "notNull": true,
        "default": "queued"
      },
      "total_blocks": {
        "kind": "int"
      },
      "completed_blocks": {
        "kind": "int",
        "notNull": true,
        "default": 0
      },
      "failed_blocks": {
        "kind": "int",
        "notNull": true,
        "default": 0
      },
      "started_at": {
        "kind": "datetime"
      },
      "finished_at": {
        "kind": "datetime"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "stories",
    "ddl": "CREATE TABLE stories (\n\tid VARCHAR NOT NULL, \n\tproject_id VARCHAR, \n\tname VARCHAR NOT NULL, \n\tdescription TEXT, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE SET NULL\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "project_id": {
        "kind": "text"
      },
      "name": {
        "kind": "text",
        "notNull": true
      },
      "description": {
        "kind": "text"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "mcp_bindings",
    "ddl": "CREATE TABLE mcp_bindings (\n\tclient_id VARCHAR NOT NULL, \n\tlabel VARCHAR, \n\tpersona_id VARCHAR, \n\tdefault_engine VARCHAR, \n\tlast_seen_at DATETIME, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (client_id), \n\tFOREIGN KEY(persona_id) REFERENCES personas (id) ON DELETE SET NULL\n)",
    "indexes": [],
    "columns": {
      "client_id": {
        "kind": "text",
        "pk": true,
        "notNull": true
      },
      "label": {
        "kind": "text"
      },
      "persona_id": {
        "kind": "text"
      },
      "default_engine": {
        "kind": "text"
      },
      "last_seen_at": {
        "kind": "datetime"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "blocks",
    "ddl": "CREATE TABLE blocks (\n\tid VARCHAR NOT NULL, \n\tscene_id VARCHAR NOT NULL, \n\tposition INTEGER NOT NULL, \n\ttext TEXT NOT NULL, \n\tspeaker_id VARCHAR, \n\tdirection VARCHAR, \n\tmetadata_json TEXT, \n\textraction_confidence FLOAT, \n\tsource VARCHAR, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(scene_id) REFERENCES scenes (id) ON DELETE CASCADE, \n\tFOREIGN KEY(speaker_id) REFERENCES speakers (id) ON DELETE SET NULL\n)",
    "indexes": [
      "CREATE INDEX ix_blocks_scene_position ON blocks (scene_id, position)"
    ],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "scene_id": {
        "kind": "text",
        "notNull": true
      },
      "position": {
        "kind": "int",
        "notNull": true
      },
      "text": {
        "kind": "text",
        "notNull": true
      },
      "speaker_id": {
        "kind": "text"
      },
      "direction": {
        "kind": "text"
      },
      "metadata_json": {
        "kind": "text"
      },
      "extraction_confidence": {
        "kind": "float"
      },
      "source": {
        "kind": "text"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "speaker_corrections",
    "ddl": "CREATE TABLE speaker_corrections (\n\tid VARCHAR NOT NULL, \n\tproject_id VARCHAR NOT NULL, \n\ttext_snippet TEXT NOT NULL, \n\tspeaker_id VARCHAR, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, \n\tFOREIGN KEY(speaker_id) REFERENCES speakers (id) ON DELETE SET NULL\n)",
    "indexes": [
      "CREATE INDEX ix_speaker_corrections_project_created ON speaker_corrections (project_id, created_at)"
    ],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "project_id": {
        "kind": "text",
        "notNull": true
      },
      "text_snippet": {
        "kind": "text",
        "notNull": true
      },
      "speaker_id": {
        "kind": "text"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "generations",
    "ddl": "CREATE TABLE generations (\n\tid VARCHAR NOT NULL, \n\tblock_id VARCHAR, \n\tpersona_id VARCHAR, \n\tprofile_id VARCHAR, \n\tproject_id VARCHAR, \n\tchapter_id VARCHAR, \n\ttext TEXT NOT NULL, \n\tlanguage VARCHAR, \n\tengine VARCHAR NOT NULL, \n\tmodel VARCHAR, \n\tseed INTEGER, \n\tinstruct TEXT, \n\taudio_path VARCHAR, \n\tduration_sec FLOAT, \n\tstatus VARCHAR NOT NULL, \n\tok_status VARCHAR NOT NULL, \n\terror TEXT, \n\tsource VARCHAR NOT NULL, \n\teffects_chain TEXT, \n\tcache_key VARCHAR, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(block_id) REFERENCES blocks (id) ON DELETE SET NULL, \n\tFOREIGN KEY(persona_id) REFERENCES personas (id) ON DELETE SET NULL\n)",
    "indexes": [
      "CREATE INDEX ix_generations_voice_status_created ON generations (profile_id, ok_status, created_at)",
      "CREATE INDEX ix_generations_project_chapter ON generations (project_id, chapter_id)"
    ],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "block_id": {
        "kind": "text"
      },
      "persona_id": {
        "kind": "text"
      },
      "profile_id": {
        "kind": "text"
      },
      "project_id": {
        "kind": "text"
      },
      "chapter_id": {
        "kind": "text"
      },
      "text": {
        "kind": "text",
        "notNull": true
      },
      "language": {
        "kind": "text",
        "default": "en"
      },
      "engine": {
        "kind": "text",
        "notNull": true
      },
      "model": {
        "kind": "text"
      },
      "seed": {
        "kind": "int"
      },
      "instruct": {
        "kind": "text"
      },
      "audio_path": {
        "kind": "text"
      },
      "duration_sec": {
        "kind": "float"
      },
      "status": {
        "kind": "text",
        "notNull": true,
        "default": "queued"
      },
      "ok_status": {
        "kind": "text",
        "notNull": true,
        "default": "ok"
      },
      "error": {
        "kind": "text"
      },
      "source": {
        "kind": "text",
        "notNull": true,
        "default": "manual"
      },
      "effects_chain": {
        "kind": "text"
      },
      "cache_key": {
        "kind": "text"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "takes",
    "ddl": "CREATE TABLE takes (\n\tid VARCHAR NOT NULL, \n\tblock_id VARCHAR NOT NULL, \n\tgeneration_id VARCHAR NOT NULL, \n\tsource_take_id VARCHAR, \n\tis_default BOOLEAN NOT NULL, \n\tlabel VARCHAR, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(block_id) REFERENCES blocks (id) ON DELETE CASCADE, \n\tFOREIGN KEY(generation_id) REFERENCES generations (id) ON DELETE CASCADE, \n\tFOREIGN KEY(source_take_id) REFERENCES takes (id) ON DELETE SET NULL\n)",
    "indexes": [
      "CREATE INDEX ix_takes_block_default ON takes (block_id, is_default)"
    ],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "block_id": {
        "kind": "text",
        "notNull": true
      },
      "generation_id": {
        "kind": "text",
        "notNull": true
      },
      "source_take_id": {
        "kind": "text"
      },
      "is_default": {
        "kind": "bool",
        "notNull": true,
        "default": false
      },
      "label": {
        "kind": "text"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "generation_versions",
    "ddl": "CREATE TABLE generation_versions (\n\tid VARCHAR NOT NULL, \n\tgeneration_id VARCHAR NOT NULL, \n\tsource_version_id VARCHAR, \n\taudio_path VARCHAR NOT NULL, \n\teffects_chain TEXT, \n\tis_default BOOLEAN NOT NULL, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(generation_id) REFERENCES generations (id) ON DELETE CASCADE, \n\tFOREIGN KEY(source_version_id) REFERENCES generation_versions (id) ON DELETE SET NULL\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "generation_id": {
        "kind": "text",
        "notNull": true
      },
      "source_version_id": {
        "kind": "text"
      },
      "audio_path": {
        "kind": "text",
        "notNull": true
      },
      "effects_chain": {
        "kind": "text"
      },
      "is_default": {
        "kind": "bool",
        "notNull": true,
        "default": false
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "render_job_blocks",
    "ddl": "CREATE TABLE render_job_blocks (\n\tid VARCHAR NOT NULL, \n\tjob_id VARCHAR NOT NULL, \n\tblock_id VARCHAR NOT NULL, \n\tgeneration_id VARCHAR, \n\tstatus VARCHAR NOT NULL, \n\tattempts INTEGER NOT NULL, \n\tlast_error TEXT, \n\tcreated_at DATETIME, \n\tupdated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(job_id) REFERENCES render_jobs (id) ON DELETE CASCADE, \n\tFOREIGN KEY(block_id) REFERENCES blocks (id) ON DELETE CASCADE, \n\tFOREIGN KEY(generation_id) REFERENCES generations (id) ON DELETE SET NULL\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "job_id": {
        "kind": "text",
        "notNull": true
      },
      "block_id": {
        "kind": "text",
        "notNull": true
      },
      "generation_id": {
        "kind": "text"
      },
      "status": {
        "kind": "text",
        "notNull": true,
        "default": "pending"
      },
      "attempts": {
        "kind": "int",
        "notNull": true,
        "default": 0
      },
      "last_error": {
        "kind": "text"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      },
      "updated_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow",
        "onupdateFn": "justvoice.database.models._utcnow"
      }
    }
  },
  {
    "name": "story_items",
    "ddl": "CREATE TABLE story_items (\n\tid VARCHAR NOT NULL, \n\tstory_id VARCHAR NOT NULL, \n\tgeneration_id VARCHAR, \n\tversion_id VARCHAR, \n\ttrack INTEGER NOT NULL, \n\tstart_time_ms INTEGER NOT NULL, \n\ttrim_start_ms INTEGER NOT NULL, \n\ttrim_end_ms INTEGER NOT NULL, \n\tvolume FLOAT NOT NULL, \n\tduration FLOAT, \n\tcreated_at DATETIME, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(story_id) REFERENCES stories (id) ON DELETE CASCADE, \n\tFOREIGN KEY(generation_id) REFERENCES generations (id) ON DELETE CASCADE, \n\tFOREIGN KEY(version_id) REFERENCES generation_versions (id) ON DELETE SET NULL\n)",
    "indexes": [],
    "columns": {
      "id": {
        "kind": "text",
        "pk": true,
        "notNull": true,
        "defaultFn": "justvoice.database.models._uuid"
      },
      "story_id": {
        "kind": "text",
        "notNull": true
      },
      "generation_id": {
        "kind": "text"
      },
      "version_id": {
        "kind": "text"
      },
      "track": {
        "kind": "int",
        "notNull": true,
        "default": 0
      },
      "start_time_ms": {
        "kind": "int",
        "notNull": true,
        "default": 0
      },
      "trim_start_ms": {
        "kind": "int",
        "notNull": true,
        "default": 0
      },
      "trim_end_ms": {
        "kind": "int",
        "notNull": true,
        "default": 0
      },
      "volume": {
        "kind": "float",
        "notNull": true,
        "default": 1.0
      },
      "duration": {
        "kind": "float"
      },
      "created_at": {
        "kind": "datetime",
        "defaultFn": "justvoice.database.models._utcnow"
      }
    }
  }
];

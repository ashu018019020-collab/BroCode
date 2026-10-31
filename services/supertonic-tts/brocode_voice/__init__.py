"""The BroCode voice service's internals: config, registry, schemas, security, engine.

`services/supertonic-tts/app.py` is the entry point (`uvicorn app:app`) and owns the HTTP routes;
everything a route DECIDES lives here so it can be unit-tested without a model.
"""

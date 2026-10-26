"""Regenerate release schemas without a running database or a DMB checkout."""
import json
from pathlib import Path
from contracts.models import QuerySpec, ToolResult, Answer, Context
from contracts.catalog import catalog
from service.app import create_app


def export(destination=Path(__file__).parent):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    app = create_app(None, None, None, "schema-generation-only-" + "x"*32, run_workers=False)
    artifacts = {"query.schema.json": QuerySpec.model_json_schema(), "tool-result.schema.json": ToolResult.model_json_schema(),
        "context.schema.json": Context.model_json_schema(),
        "answer.schema.json": Answer.model_json_schema(), "tools.json": catalog(), "agent.openapi.json": app.openapi()}
    for name, body in artifacts.items():
        (destination / name).write_text(json.dumps(body, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")


if __name__ == "__main__":
    export()

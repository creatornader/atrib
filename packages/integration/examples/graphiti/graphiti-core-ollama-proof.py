# SPDX-License-Identifier: Apache-2.0

import asyncio
import json
import os
from datetime import datetime, timezone
from time import time
from urllib.parse import urlparse

from graphiti_core import Graphiti
from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient
from graphiti_core.driver.falkordb_driver import FalkorDriver
from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
from graphiti_core.llm_client.config import LLMConfig
from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient
from graphiti_core.nodes import EpisodeType


def env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value else default


async def main() -> None:
    falkordb_uri = env("FALKORDB_URI", "redis://127.0.0.1:6379")
    parsed_falkor = urlparse(falkordb_uri)
    if parsed_falkor.scheme not in {"redis", "falkor"}:
        raise ValueError("FALKORDB_URI must use redis:// or falkor://")

    group_id = env("GRAPHITI_GROUP_ID", f"atrib_graphiti_ollama_{int(time())}")
    episode_body = env(
        "GRAPHITI_EPISODE_BODY",
        (
            "Nader uses atrib to sign Graphiti episode writes before memory search. "
            "The proof phrase is cobalt ledger."
        ),
    )
    source_description = "local Graphiti core plus Ollama proof"
    query = env("GRAPHITI_SEARCH_QUERY", "cobalt ledger")
    ollama_base_url = env("GRAPHITI_OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1")
    ollama_model = env("GRAPHITI_OLLAMA_MODEL", "qwen2.5:7b-instruct")
    embed_model = env("GRAPHITI_OLLAMA_EMBED_MODEL", "nomic-embed-text")
    embed_dim = int(env("GRAPHITI_OLLAMA_EMBED_DIM", "768"))

    driver = FalkorDriver(
        host=parsed_falkor.hostname or "127.0.0.1",
        port=parsed_falkor.port or 6379,
        password=os.environ.get("FALKORDB_PASSWORD"),
        database=env("FALKORDB_DATABASE", "atrib_graphiti_ollama_proof"),
    )
    llm_config = LLMConfig(
        api_key="ollama",
        model=ollama_model,
        small_model=ollama_model,
        base_url=ollama_base_url,
        temperature=0,
        max_tokens=4096,
    )
    llm_client = OpenAIGenericClient(config=llm_config)
    embedder = OpenAIEmbedder(
        config=OpenAIEmbedderConfig(
            api_key="ollama",
            embedding_model=embed_model,
            embedding_dim=embed_dim,
            base_url=ollama_base_url,
        )
    )

    graphiti = Graphiti(
        graph_driver=driver,
        llm_client=llm_client,
        embedder=embedder,
        cross_encoder=OpenAIRerankerClient(client=llm_client, config=llm_config),
        max_coroutines=1,
    )

    add_args = {
        "name": "atrib proof episode",
        "episode_body": episode_body,
        "source": "text",
        "source_description": source_description,
        "group_id": group_id,
    }
    retrieve_args = {"group_ids": [group_id], "last_n": 5}
    search_args = {"query": query, "group_ids": [group_id]}

    try:
        await graphiti.build_indices_and_constraints()
        await graphiti.add_episode(
            name=add_args["name"],
            episode_body=episode_body,
            source=EpisodeType.text,
            source_description=source_description,
            reference_time=datetime.now(timezone.utc),
            group_id=group_id,
        )
        episodes = await graphiti.retrieve_episodes(
            reference_time=datetime.now(timezone.utc),
            last_n=retrieve_args["last_n"],
            group_ids=retrieve_args["group_ids"],
        )
        search_results = await graphiti.search(query, group_ids=search_args["group_ids"])
        search_facts = [
            {
                "name": getattr(result, "name", None),
                "fact": getattr(result, "fact", None),
            }
            for result in search_results[:5]
        ]

        if not episodes:
            raise RuntimeError("Graphiti returned no episodes after add_episode")
        if not search_results:
            raise RuntimeError("Graphiti search returned no facts")

        print(
            json.dumps(
                {
                    "ok": True,
                    "graphiti_core_version": "0.29.1",
                    "group_id": group_id,
                    "llm_model": ollama_model,
                    "embed_model": embed_model,
                    "falkordb_uri": falkordb_uri,
                    "operations": [
                        {
                            "operation": "graphiti.core.add_episode",
                            "args": add_args,
                            "result": {
                                "status": "ok",
                                "group_id": group_id,
                            },
                        },
                        {
                            "operation": "graphiti.core.retrieve_episodes",
                            "args": retrieve_args,
                            "result": {
                                "episode_count": len(episodes),
                                "contains_proof_phrase": any(
                                    query in episode.content for episode in episodes
                                ),
                            },
                        },
                        {
                            "operation": "graphiti.core.search",
                            "args": search_args,
                            "result": {
                                "search_result_count": len(search_results),
                                "facts": search_facts,
                            },
                        },
                    ],
                    "summary": {
                        "episode_count": len(episodes),
                        "search_result_count": len(search_results),
                        "episode_contains_proof_phrase": any(
                            query in episode.content for episode in episodes
                        ),
                        "search_facts": search_facts,
                    },
                },
                indent=2,
            )
        )
    finally:
        await graphiti.close()


if __name__ == "__main__":
    asyncio.run(main())

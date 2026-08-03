#!/usr/bin/env python3
"""
Utilitário para remover um canal existente da TV2.

Uso:
    python scripts/utils/remove_channel.py --name "fudencio II"
"""

import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from linker import load_existing_json, save_json, save_js

def remove_channel(target_name):
    channels = load_existing_json()
    initial_count = len(channels)
    
    channels = [ch for ch in channels if ch.get('name', '').lower() != target_name.lower()]
    
    if len(channels) == initial_count:
        print(f"Canal '{target_name}' não foi encontrado.")
        return False
        
    save_json(channels)
    save_js(channels)
    print(f"Canal '{target_name}' removido com sucesso. ({initial_count} -> {len(channels)} canais)")
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Remover um canal da TV2")
    parser.add_argument("--name", required=True, help="Nome do canal a ser removido")
    
    args = parser.parse_args()
    remove_channel(args.name)

#!/usr/bin/env python3
"""
Gerenciador Central de Canais da TV2.

Uso:
    python scripts/manage.py list               -> Lista os canais e estatísticas
    python scripts/manage.py deduplicate        -> Remove vídeos duplicados
    python scripts/manage.py remove --name X   -> Remove o canal X
    python scripts/manage.py add --name N --label L --urls U1 U2 -> Adiciona/atualiza canal
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from linker import load_existing_json

def list_channels():
    channels = load_existing_json()
    print(f"\n=== GRADE ATUAL DA TV2 ({len(channels)} CANAIS) ===\n")
    total_dur = 0
    total_vids = 0
    for idx, ch in enumerate(channels, 1):
        vids = ch['items']
        dur = sum(v['duration'] for v in vids)
        total_vids += len(vids)
        total_dur += dur
        h = dur // 3600
        m = (dur % 3600) // 60
        print(f"[{idx:02d}] {ch['label']} (id: {ch['name']}) - {len(vids)} vídeos | {h}h {m}m ({dur}s)")
    print(f"\nTOTAL: {total_vids} vídeos | {total_dur//3600}h {(total_dur%3600)//60}m no total.\n")

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] in ("--help", "-h", "help"):
        print(__doc__)
        sys.exit(0)
        
    cmd = sys.argv[1].lower()
    if cmd in ("list", "ls"):
        list_channels()
    elif cmd in ("clean", "deduplicate"):
        from utils.clean_duplicates import deduplicate_channels
        deduplicate_channels()
    elif cmd == "remove":
        sys.argv.pop(1)
        from utils.remove_channel import remove_channel
        import argparse
        parser = argparse.ArgumentParser()
        parser.add_argument("--name", required=True)
        args = parser.parse_args()
        remove_channel(args.name)
    elif cmd in ("add", "update"):
        sys.argv.pop(1)
        from utils.add_channel import add_or_update_channel
        import argparse
        parser = argparse.ArgumentParser()
        parser.add_argument("--name", required=True)
        parser.add_argument("--label", required=True)
        parser.add_argument("--urls", nargs="+", required=True)
        args = parser.parse_args()
        add_or_update_channel(args.name, args.label, args.urls)
    else:
        print(f"Comando '{cmd}' desconhecido. Use --help para ver opções.")

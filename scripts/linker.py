#!/usr/bin/env python3
"""
BOLSO.TV — Channel Builder
==========================
Constrói a grade de canais a partir de links/playlists do YouTube.

Uso:
    pip install yt-dlp
    python bolso_builder.py

Saída:
    channels.json   → consumido pelo servidor (modo dinâmico)
    channels.js     → bloco pronto pra colar no HTML (modo local)

Recursos:
    - Vídeos individuais, shorts, playlists
    - Episódios agrupados (várias partes que tocam em sequência)
    - Detecção automática de "Parte 1 / Parte 2 / Ep 1 / Cap X"
    - Agrupamento manual de qualquer conjunto de vídeos
    - Salva incrementalmente, carrega estado anterior
"""

import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# ─────────────────────────────────────────────────────────────
# Dependências
# ─────────────────────────────────────────────────────────────
try:
    import yt_dlp
except ImportError:
    print("ERRO: yt-dlp não está instalado.")
    print("Rode: pip install yt-dlp")
    sys.exit(1)

# Habilita cores ANSI no Windows 10+
if sys.platform == 'win32':
    os.system('')

# ═════════════════════════════════════════════════════════════
# CONFIGURAÇÃO
# ═════════════════════════════════════════════════════════════
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.path.join(_SCRIPT_DIR, '..', 'data')

OUTPUT_JSON = os.path.join(_DATA_DIR, "channels.json")
OUTPUT_JS   = os.path.join(_DATA_DIR, "channels.js")
COOKIE_FILE = os.path.join(_DATA_DIR, "cookies.txt")

# YouTube Data API (placeholder — desligado por enquanto)
USE_YOUTUBE_API = False
YOUTUBE_API_KEY = ""

MAX_PLAYLIST_AUTO = 50   # confirma se playlist > N vídeos

# ═════════════════════════════════════════════════════════════
# CORES (ANSI)
# ═════════════════════════════════════════════════════════════
class C:
    G    = '\033[92m'
    Y    = '\033[93m'
    R    = '\033[91m'
    B    = '\033[94m'
    M    = '\033[95m'
    GR   = '\033[90m'
    BOLD = '\033[1m'
    END  = '\033[0m'

def info(msg):  print(f"{C.B}→{C.END} {msg}")
def ok(msg):    print(f"{C.G}✓{C.END} {msg}")
def warn(msg):  print(f"{C.Y}!{C.END} {msg}")
def err(msg):   print(f"{C.R}✗{C.END} {msg}")
def head(msg):  print(f"\n{C.BOLD}{C.G}═══ {msg} ═══{C.END}")

def prompt(msg, default=None):
    suffix = f" {C.GR}[{default}]{C.END}" if default else ""
    val = input(f"{C.M}▶{C.END} {msg}{suffix}: ").strip()
    return val or (default or "")

# ═════════════════════════════════════════════════════════════
# PROVIDERS DE METADADOS
# ═════════════════════════════════════════════════════════════

class MetadataProvider:
    def fetch_video(self, video_id):
        raise NotImplementedError
    def fetch_playlist(self, playlist_id):
        raise NotImplementedError


class YtDlpProvider(MetadataProvider):
    def __init__(self):
        self.opts = {
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'extract_flat': False,
            'extractor_args': {
                'youtube': {'player_client': ['ios']}
            }
        }
        if os.path.exists(COOKIE_FILE):
            self.opts['cookiefile'] = COOKIE_FILE

    def fetch_video(self, video_id):
        url = f"https://www.youtube.com/watch?v={video_id}"
        try:
            with yt_dlp.YoutubeDL(self.opts) as ydl:
                d = ydl.extract_info(url, download=False)
            return {
                'id':             d['id'],
                'title':          d.get('title') or 'Sem título',
                'duration':       int(d.get('duration') or 0),
                'age_restricted': (d.get('age_limit') or 0) >= 18,
                'live':           bool(d.get('is_live')),
            }
        except Exception as e:
            err(f"Falha em {video_id}: {e}")
            return None

    def fetch_playlist(self, playlist_id):
        """Resolve uma playlist completa.

        Bug conhecido do YouTube + yt-dlp em playlists grandes (issue #16943).
        Aplicamos `youtubetab:skip=webpage` que aumenta o limite (em versões
        anteriores ao fix #16948 era 100 → ~230; após o fix, ilimitado).
        """
        url = f"https://www.youtube.com/playlist?list={playlist_id}"
        opts = {
            **self.opts,
            'extract_flat':   'in_playlist',
            'playliststart':  1,
            'playlistend':    None,
            'lazy_playlist':  False,
            'ignoreerrors':   True,
            'extractor_args': {
                'youtubetab': {'skip': ['webpage', 'authcheck']},
            },
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                pl = ydl.extract_info(url, download=False)
            if pl is None:
                err(f"Playlist {playlist_id}: retornou vazio.")
                return []
            entries    = pl.get('entries', []) or []
            valid      = [e for e in entries if e and e.get('id')]
            meta_count = pl.get('playlist_count')
            if meta_count and meta_count > len(valid):
                warn(
                    f"yt-dlp só pegou {len(valid)} de {meta_count} vídeos."
                )
                warn(
                    "BUG conhecido do yt-dlp em playlists grandes "
                    "(issue #16943, fix #16948)."
                )
                warn("Tente atualizar pro yt-dlp nightly que tem o fix:")
                print(f"      {C.Y}pip install -U --pre yt-dlp{C.END}")
            
            return [{
                'id': e['id'],
                'title': e.get('title') or 'Sem título',
                'duration': int(e.get('duration') or 0),
                'age_restricted': False,
                'live': False
            } for e in valid]
        except Exception as e:
            err(f"Falha na playlist {playlist_id}: {e}")
            return []


class YouTubeApiProvider(MetadataProvider):
    """Esqueleto pronto. Implementar quando tiver chave."""
    def __init__(self, api_key):
        self.api_key = api_key

    def fetch_video(self, video_id):
        raise NotImplementedError("YouTube Data API ainda não implementada.")

    def fetch_playlist(self, playlist_id):
        raise NotImplementedError("YouTube Data API ainda não implementada.")


def get_provider():
    if USE_YOUTUBE_API and YOUTUBE_API_KEY:
        info("Usando YouTube Data API")
        return YouTubeApiProvider(YOUTUBE_API_KEY)
    return YtDlpProvider()


# ═════════════════════════════════════════════════════════════
# PARSE DE URLs
# ═════════════════════════════════════════════════════════════

YT_VIDEO_PATTERNS = [
    r'(?:youtube\.com/watch\?v=)([A-Za-z0-9_-]{11})',
    r'(?:youtu\.be/)([A-Za-z0-9_-]{11})',
    r'(?:youtube\.com/embed/)([A-Za-z0-9_-]{11})',
    r'(?:youtube\.com/shorts/)([A-Za-z0-9_-]{11})',
    r'(?:youtube\.com/live/)([A-Za-z0-9_-]{11})',
]

def extract_video_id(url):
    for pat in YT_VIDEO_PATTERNS:
        m = re.search(pat, url)
        if m:
            return m.group(1)
    if re.match(r'^[A-Za-z0-9_-]{11}$', url.strip()):
        return url.strip()
    return None

def extract_playlist_id(url):
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    if 'list' in qs:
        return qs['list'][0]
    m = re.search(r'list=([A-Za-z0-9_-]+)', url)
    return m.group(1) if m else None

def looks_like_playlist(url):
    pid = extract_playlist_id(url)
    if not pid:
        return False
    # ?v= E ?list= → vídeo dentro de playlist, tratamos como vídeo único
    if '/playlist' in url:
        return True
    if 'v=' in url:
        return False
    return True


# ═════════════════════════════════════════════════════════════
# DETECÇÃO DE EPISÓDIOS / PARTES
# ═════════════════════════════════════════════════════════════

# Padrões que extraem o NÚMERO da parte (e o trecho a remover).
# IMPORTANTE: não consumimos hífens — pós-processamento limpa hífens órfãos.
PART_REGEX = [
    re.compile(r'\s*\bpartes?\s*0*(\d+)\b\s*',                       re.I),  # "Parte 2"
    re.compile(r'\s*\bparts?\s*0*(\d+)\b\s*',                        re.I),  # "Part 2"
    re.compile(r'\s*\bep(?:isódio|isodio)?\s*0*(\d+)\b\s*',          re.I),  # "Ep 1"
    re.compile(r'\s*\bcap(?:ítulo|itulo)?\s*0*(\d+)\b\s*',           re.I),  # "Cap 1"
    re.compile(r'\s*[\(\[]\s*0*(\d+)\s*(?:de|/)\s*\d+\s*[\)\]]\s*',  re.I),  # "(1 de 3)" / "[1/3]"
    re.compile(r'\s*#\s*0*(\d+)\b\s*',                               re.I),  # "#1"
]

def _clean_base(s):
    """Limpa hífens duplos, espaços extras e pontas órfãs após remover o marker."""
    s = re.sub(r'\s*[\-\u2013\u2014]\s*[\-\u2013\u2014]\s*', ' - ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'^[\s\-\u2013\u2014]+|[\s\-\u2013\u2014]+$', '', s)
    return s

def extract_part_info(title):
    """Retorna (num_parte, titulo_base) ou (None, title) se nada bateu."""
    for pat in PART_REGEX:
        m = pat.search(title)
        if m:
            num  = int(m.group(1))
            base = _clean_base(pat.sub(' ', title, count=1))
            return num, base
    return None, title


def detect_episode_groups(videos):
    """Agrupa vídeos por título-base. Retorna lista de grupos com 2+ partes."""
    groups = {}  # base_normalizado → [(idx, num_parte, video)]
    for i, v in enumerate(videos):
        num, base = extract_part_info(v['title'])
        if num is None or not base:
            continue
        key = base.lower()
        groups.setdefault(key, {'base': base, 'parts': []})
        groups[key]['parts'].append((i, num))

    result = []
    for g in groups.values():
        if len(g['parts']) >= 2:
            g['parts'].sort(key=lambda x: x[1])  # ordena por número de parte
            result.append(g)
    return result


def parse_index_spec(spec, total, exclude=None):
    """Parse '1,3,5' ou '1-3,7' em índices 0-based. Retorna lista ordenada (como digitado)."""
    exclude = exclude or set()
    out = []
    for chunk in spec.split(','):
        chunk = chunk.strip()
        if not chunk:
            continue
        if '-' in chunk:
            try:
                a, b = chunk.split('-', 1)
                a, b = int(a), int(b)
                for i in range(min(a, b), max(a, b) + 1):
                    if 1 <= i <= total and (i - 1) not in exclude:
                        out.append(i - 1)
            except ValueError:
                return None
        else:
            try:
                i = int(chunk)
                if 1 <= i <= total and (i - 1) not in exclude:
                    out.append(i - 1)
            except ValueError:
                return None
    # remove duplicatas mantendo ordem
    seen = set(); uniq = []
    for i in out:
        if i not in seen:
            seen.add(i); uniq.append(i)
    return uniq


def define_episodes(videos):
    """Pergunta sobre agrupamento. Retorna lista de items (video|episode) na ordem final."""
    if len(videos) < 2:
        return [{'type': 'video', **v} for v in videos]

    head("AGRUPAR EM EPISÓDIOS?")
    info("Episódio = vídeos que tocam em sequência como 1 item da programação.")
    info("Ex: 'Parte 1' + 'Parte 2' = 1 episódio na grade.\n")

    accepted = []   # [(titulo, [indices_ordenados])]
    used = set()

    # ── Fase 1: auto-detect ──
    auto_groups = detect_episode_groups(videos)
    if auto_groups:
        info(f"Detectei {len(auto_groups)} grupo(s) potencial(is):\n")
        for g in auto_groups:
            print(f"  {C.G}■{C.END} {C.BOLD}{g['base']}{C.END}")
            for idx, num in g['parts']:
                v = videos[idx]
                print(f"      Parte {num}: {v['title'][:65]} ({v['duration']}s)")
            ans = prompt("Aceitar este episódio? [s/n/e=editar título]", "s").lower()
            if ans.startswith('s'):
                accepted.append((g['base'], [idx for idx, _ in g['parts']]))
                used.update(idx for idx, _ in g['parts'])
            elif ans.startswith('e'):
                new_title = prompt("Novo título", g['base'])
                accepted.append((new_title, [idx for idx, _ in g['parts']]))
                used.update(idx for idx, _ in g['parts'])
            print()
    else:
        info("Nenhum padrão 'Parte N' / 'Ep N' detectado automaticamente.\n")

    # ── Fase 2: agrupamento manual ──
    while True:
        available = [(i, v) for i, v in enumerate(videos) if i not in used]
        if len(available) < 2:
            break

        print(f"\n{C.GR}Vídeos não agrupados ({len(available)}):{C.END}")
        for i, v in available:
            print(f"  {i+1}. {v['title'][:65]} ({v['duration']}s)")

        spec = prompt(
            "\nAgrupar quais? (ex: '1,3' ou '2-5'; Enter pra terminar)"
        )
        if not spec:
            break

        idxs = parse_index_spec(spec, len(videos), exclude=used)
        if not idxs:
            err("Seleção inválida ou conflita com episódios já criados.")
            continue
        if len(idxs) < 2:
            err("Episódio precisa de pelo menos 2 vídeos.")
            continue

        title = prompt("Título do episódio").strip()
        if not title:
            err("Título vazio. Cancelado.")
            continue

        accepted.append((title, idxs))
        used.update(idxs)
        ok(f"Episódio criado: '{title}' com {len(idxs)} partes.")

    # ── Fase 3: montar lista final preservando ordem original ──
    items = []
    placed = set()
    title_by_idx = {}
    indices_by_title = {}
    for title, idxs in accepted:
        for idx in idxs:
            title_by_idx[idx] = title
        indices_by_title[title] = idxs

    for i, v in enumerate(videos):
        if i in title_by_idx:
            t = title_by_idx[i]
            if t in placed:
                continue
            placed.add(t)
            ordered = indices_by_title[t]
            parts = [videos[k] for k in ordered]
            items.append({
                'type':     'episode',
                'title':    t,
                'duration': sum(p['duration'] for p in parts),
                'parts':    parts,
            })
        else:
            items.append({'type': 'video', **v})

    return items


# ═════════════════════════════════════════════════════════════
# CONVERSÃO INTERNO ↔ EXTERNO
# ═════════════════════════════════════════════════════════════

def _video_out(v):
    d = {"type": "yt", "id": v['id'], "title": v['title'], "dur": v['duration']}
    if v.get('age_restricted'):
        d['ageRestricted'] = True
    return d

def item_to_output(item):
    if item['type'] == 'video':
        return _video_out(item)
    # episode
    return {
        "type":  "episode",
        "title": item['title'],
        "dur":   item['duration'],
        "parts": [_video_out(p) for p in item['parts']],
    }

def channel_to_output(ch):
    return {
        "name":   ch['name'],
        "label":  ch['label'],
        "videos": [item_to_output(it) for it in ch['items']],
    }

def normalize_loaded_channel(ch):
    """JSON carregado → estrutura interna. Aceita formato antigo (sem episodes)."""
    items = []
    for v in ch.get('videos', []):
        if v.get('type') == 'episode':
            items.append({
                'type':     'episode',
                'title':    v['title'],
                'duration': v['dur'],
                'parts': [{
                    'id':             p['id'],
                    'title':          p['title'],
                    'duration':       p['dur'],
                    'age_restricted': p.get('ageRestricted', False),
                } for p in v.get('parts', [])],
            })
        else:
            items.append({
                'type':           'video',
                'id':             v['id'],
                'title':          v['title'],
                'duration':       v['dur'],
                'age_restricted': v.get('ageRestricted', False),
            })
    return {'name': ch['name'], 'label': ch['label'], 'items': items}


# ═════════════════════════════════════════════════════════════
# CONSTRUÇÃO DE CANAIS
# ═════════════════════════════════════════════════════════════

def make_label(idx, name):
    short = name.split()[0].upper()[:10] if name.strip() else f"CANAL{idx}"
    return f"CH {idx:02d} · {short}"


def process_playlist(provider, link):
    pid = extract_playlist_id(link)
    info(f"Playlist detectada: {pid}")
    items = provider.fetch_playlist(pid)
    if not items:
        err("Playlist vazia ou indisponível.")
        return []
    info(f"  ↳ {len(items)} vídeo(s) na playlist")

    if len(items) > 100:  # Hardcoded instead of MAX_PLAYLIST_AUTO for safety
        c = prompt(f"Playlist tem {len(items)} vídeos. Continuar?", "s")
        if c.lower() not in ('s', 'sim', 'y', 'yes'):
            return []

    videos = []
    for i, item in enumerate(items, 1):
        print(f"   [{i}/{len(items)}] {item['id']}... ", end='', flush=True)
        v = item
        if v and v['duration'] > 0:
            tag = f" {C.Y}+18{C.END}" if v.get('age_restricted') else ""
            print(f"{C.G}✓{C.END} {v['title'][:55]} ({v['duration']}s){tag}")
            videos.append(v)
        else:
            print(f"{C.R}✗ pulado (sem duração ou bloqueado){C.END}")
    return videos


def process_single_video(provider, link):
    vid = extract_video_id(link)
    if not vid:
        err("Link não reconhecido como vídeo nem playlist do YouTube.")
        return []
    info(f"Buscando metadados de {vid}...")
    v = provider.fetch_video(vid)
    if not v or v['duration'] <= 0:
        err("Vídeo indisponível (privado/removido/live?). Pulado.")
        return []
    tag = f" {C.Y}[+18]{C.END}" if v['age_restricted'] else ""
    ok(f"{v['title']} ({v['duration']}s){tag}")
    return [v]


def build_channel(provider, channel_idx):
    head(f"NOVO CANAL #{channel_idx}")

    name = ""
    while not name:
        name = prompt("Nome do canal (ex: JACK STAUBER)")
        if not name:
            err("Nome não pode ser vazio.")

    default_label = make_label(channel_idx, name)
    label = prompt("Label do botão", default_label)

    videos = []
    info("Cole os links. Enter vazio = finalizar canal.")
    info(f"Comandos: {C.Y}!mostrar{C.END} {C.GR}(lista){C.END}, "
         f"{C.Y}!remover{C.END} {C.GR}(remove último){C.END}, "
         f"{C.Y}!cancelar{C.END} {C.GR}(aborta){C.END}\n")

    while True:
        link = prompt(f"Link [{len(videos)} vídeo(s)]")

        if not link:
            if not videos:
                warn("Canal vazio. Adicione 1+ vídeo ou use !cancelar.")
                continue
            break

        if link == "!mostrar":
            if not videos:
                print(f"  {C.GR}(vazio){C.END}")
            for i, v in enumerate(videos, 1):
                print(f"  {i}. [{v['id']}] {v['title']} ({v['duration']}s)")
            continue

        if link == "!remover":
            if videos:
                rm = videos.pop()
                warn(f"Removido: {rm['title']}")
            else:
                warn("Lista vazia.")
            continue

        if link == "!cancelar":
            if prompt("Cancelar este canal e descartar?", "n").lower() in ('s', 'sim'):
                warn("Canal descartado.")
                return None
            continue

        # Decide: playlist ou vídeo único
        if looks_like_playlist(link):
            new_videos = process_playlist(provider, link)
            # Em playlists >5, não pergunta título por vídeo (tedioso)
            customize = False
            if 0 < len(new_videos) <= 5:
                customize = True
            elif new_videos:
                ans = prompt(
                    f"Personalizar título dos {len(new_videos)} vídeos um por um?", "n"
                ).lower()
                customize = ans.startswith('s')
        else:
            new_videos = process_single_video(provider, link)
            customize = True

        for v in new_videos:
            if customize:
                custom = input(
                    f"   {C.M}↳{C.END} Título p/ '{v['title'][:50]}' "
                    f"{C.GR}(Enter = manter){C.END}: "
                ).strip()
                if custom:
                    v['title'] = custom
            videos.append(v)

    # ── Agrupamento em episódios ──
    items = define_episodes(videos)

    return {
        "name":  name,
        "label": label,
        "items": items,
    }


# ═════════════════════════════════════════════════════════════
# I/O DE SAÍDA
# ═════════════════════════════════════════════════════════════

def load_existing_json(path=OUTPUT_JSON):
    p = Path(path)
    if not p.exists():
        return []
    try:
        with p.open('r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, list):
            return [normalize_loaded_channel(ch) for ch in data]
    except Exception as e:
        warn(f"Não consegui ler {path}: {e}. Começando do zero.")
    return []


def save_json(channels, path=OUTPUT_JSON):
    out = [channel_to_output(ch) for ch in channels]
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    ok(f"JSON salvo em {path}")


def _render_video_js(v, indent):
    title = json.dumps(v['title'], ensure_ascii=False)
    extra = ', ageRestricted: true' if v.get('age_restricted') else ''
    return f'{indent}{{ type: "yt", id: "{v["id"]}", title: {title}, dur: {v["duration"]}{extra} }}'

def _render_episode_js(ep, indent):
    title = json.dumps(ep['title'], ensure_ascii=False)
    lines = [f'{indent}{{']
    lines.append(f'{indent}  type: "episode",')
    lines.append(f'{indent}  title: {title},')
    lines.append(f'{indent}  dur: {ep["duration"]},')
    lines.append(f'{indent}  parts: [')
    for p in ep['parts']:
        lines.append(_render_video_js(p, indent + '    ') + ',')
    lines.append(f'{indent}  ]')
    lines.append(f'{indent}}}')
    return '\n'.join(lines)

def _render_item_js(item, indent):
    if item['type'] == 'video':
        return _render_video_js(item, indent)
    return _render_episode_js(item, indent)

def save_js(channels, path=OUTPUT_JS):
    lines = []
    lines.append("// ═══════════════════════════════════════════════════")
    lines.append("// Gerado por bolso_builder.py")
    lines.append("// Cole no lugar de `const CHANNELS = [...]`")
    lines.append("// ═══════════════════════════════════════════════════")
    lines.append("const CHANNELS = [")
    for ch in channels:
        lines.append("  {")
        lines.append(f'    name:  {json.dumps(ch["name"],  ensure_ascii=False)},')
        lines.append(f'    label: {json.dumps(ch["label"], ensure_ascii=False)},')
        lines.append("    videos: [")
        for it in ch['items']:
            lines.append(_render_item_js(it, "      ") + ",")
        lines.append("    ]")
        lines.append("  },")
    lines.append("];")
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    ok(f"JS salvo em {path}")


# ═════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════

def channel_summary(ch):
    """Soma de duração + contagem (achata episódios)."""
    n_items = len(ch['items'])
    total = 0
    n_videos = 0
    n_episodes = 0
    for it in ch['items']:
        total += it['duration']
        if it['type'] == 'episode':
            n_episodes += 1
            n_videos += len(it['parts'])
        else:
            n_videos += 1
    return n_items, n_videos, n_episodes, total


def fmt_dur(total_s):
    h, rest = divmod(total_s, 3600)
    m = rest // 60
    return f"{h}h{m:02d}min" if h else f"{m}min"


def banner():
    print(f"{C.G}{C.BOLD}")
    print("╔════════════════════════════════════════╗")
    print("║   BOLSO.TV  —  CHANNEL BUILDER        ║")
    print("╚════════════════════════════════════════╝")
    print(C.END)


def main():
    banner()
    provider = get_provider()
    info(f"Provider ativo: {C.Y}{type(provider).__name__}{C.END}")
    try:
        ytv = getattr(yt_dlp.version, '__version__', '?')
        info(f"yt-dlp versão: {C.Y}{ytv}{C.END} "
             f"{C.GR}(se der problema em playlists grandes: pip install -U --pre yt-dlp){C.END}")
    except Exception:
        pass

    channels = load_existing_json()
    if channels:
        info(f"Achei {len(channels)} canal(is) em {OUTPUT_JSON}:")
        for i, c in enumerate(channels, 1):
            ni, nv, ne, tot = channel_summary(c)
            extra = f" ({ne} episódio(s))" if ne else ""
            print(f"  {i}. {c['label']} — {ni} item(s){extra} · {fmt_dur(tot)}")
        action = prompt(
            "\nO que fazer? [a]dicionar / [s]obrescrever / sair (q)", "a"
        ).lower()
        if action.startswith('s'):
            channels = []
            warn("Canais existentes serão sobrescritos.")
        elif action.startswith('q'):
            info("Saindo sem mexer.")
            return

    while True:
        ch = build_channel(provider, len(channels) + 1)
        if ch:
            channels.append(ch)
            ni, nv, ne, tot = channel_summary(ch)
            extra = f" ({ne} episódio(s))" if ne else ""
            ok(f"Canal '{ch['name']}' salvo: {ni} item(s){extra} · {fmt_dur(tot)}")
            save_json(channels)  # incremental
        cont = prompt("\nAdicionar outro canal?", "n").lower()
        if cont not in ('s', 'sim', 'y', 'yes'):
            break

    save_json(channels)
    save_js(channels)

    print()
    head("PRONTO!")
    print(f"  {len(channels)} canal(is) salvos:\n")
    for ch in channels:
        ni, nv, ne, tot = channel_summary(ch)
        extra = f"  +{ne} ep" if ne else ""
        print(f"    {C.G}■{C.END} {ch['label']:30s} {ni:3d} itens{extra}  ·  {fmt_dur(tot)}")
    print()
    info(f"Gerados: {C.Y}{OUTPUT_JSON}{C.END} (servidor) e {C.Y}{OUTPUT_JS}{C.END} (local)")
    warn("OBS: o HTML antigo não entende `type: 'episode'`. Vai funcionar quando refazermos o front.")


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print(f"\n{C.Y}Cancelado.{C.END}")
        sys.exit(0)
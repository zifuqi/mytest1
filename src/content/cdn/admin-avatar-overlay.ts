// wf-admin-avatar-overlay-v1: read only activated medium patch archives.
import { createHash } from "node:crypto"
import path from "node:path"
import { MediumArchiveIndex } from "./medium-archive-index"
import type { ArchiveSourceManifest } from "./archive-sources"
import type { CdnCatalog } from "./types"

export interface AvatarSnapshot {
    readonly cdn: CdnCatalog
    readonly archiveSources: ArchiveSourceManifest
}

export interface AvatarOverlay {
    readonly cacheKey: string
    readonly index: MediumArchiveIndex
}

const cache = new WeakMap<AvatarSnapshot, Map<string, AvatarOverlay | null>>()

function compareVersion(a: string, b: string): number {
    const left = a.split(".").map(Number)
    const right = b.split(".").map(Number)
    for (let i = 0; i < 3; i++) {
        if (left[i] !== right[i]) return left[i] - right[i]
    }
    return 0
}

export function getAvatarOverlay(cdnRoot: string, snapshot: AvatarSnapshot | null): AvatarOverlay | null {
    if (snapshot === null) return null
    const root = path.resolve(cdnRoot)
    let roots = cache.get(snapshot)
    if (roots?.has(root)) return roots.get(root)!
    if (roots === undefined) {
        roots = new Map()
        cache.set(snapshot, roots)
    }
    const sources = new Map(snapshot.archiveSources.archives.map(a => [a.relativePath, a.source]))
    const archives = new Map<string, { zipPath: string; version: string; order: number; sha256: string }>()
    for (const edge of snapshot.cdn.edges) {
        if (compareVersion(edge.toVersion, snapshot.cdn.targetVersion) > 0) continue
        for (const archive of edge.archives) {
            if (archive.layer !== "quality") continue
            const source = sources.get(archive.relativePath)
            if (source === undefined) throw new Error("Avatar archive source missing: " + archive.relativePath)
            if (source.kind !== "patch") continue
            if (!/^\d+\.\d+\.\d+$/.test(source.targetVersion)
                || source.targetVersion !== edge.toVersion
                || !/^archive-medium-diff\/[A-Za-z0-9_.-]+\.zip$/.test(archive.relativePath)) {
                throw new Error("Invalid avatar patch source")
            }
            // Full/diff catalog edges can refer to the same immutable archive.
            archives.set(archive.relativePath, {
                zipPath: path.join(path.dirname(root), "patches", source.targetVersion, archive.relativePath),
                version: source.targetVersion,
                order: archive.order,
                sha256: archive.sha256,
            })
        }
    }
    const ordered = [...archives.values()].sort((a, b) =>
        compareVersion(b.version, a.version) || b.order - a.order || a.zipPath.localeCompare(b.zipPath))
    if (ordered.length === 0) {
        roots.set(root, null)
        return null
    }
    const overlay: AvatarOverlay = {
        cacheKey: createHash("sha256").update(JSON.stringify(ordered)).digest("hex").slice(0, 24),
        index: new MediumArchiveIndex(path.join(path.dirname(root), "patches"), {
            listArchives: async () => ordered.map(a => a.zipPath),
        }),
    }
    roots.set(root, overlay)
    return overlay
}

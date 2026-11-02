import { planCdnUpdate } from "../../content/cdn/planner"
import { serializeCdnUpdatePlan, type CnAssetUpdateWire } from "../../content/cdn/protocol"
import type { CdnCatalog } from "../../content/cdn/types"

interface UsbBasePlan {
    readonly version: string
    readonly baseUrl: string
    readonly archives: readonly { readonly name: string; readonly size: number; readonly sha256: string }[]
}

// Keep the USB base at 1.4.54; append the server's ordinary CDN diff chain.
export function planUsbOverlay(
    catalog: CdnCatalog,
    usb: UsbBasePlan,
    currentVersion: string | null,
    onlineBaseUrl: string,
): CnAssetUpdateWire {
    if (usb.version !== "1.4.54") throw new Error("unsupported USB base version")
    const needsUsbBase = currentVersion === null
        || currentVersion === ""
        || /^1\.4\.([0-9]|[1-4][0-9]|5[0-3])$/.test(currentVersion)
    const plan = planCdnUpdate(catalog, {
        currentVersion: needsUsbBase ? usb.version : currentVersion,
        targetVersion: catalog.targetVersion,
        platform: "android",
        assetSizeKind: "fulfill",
        isInitial: false,
    })
    const data = serializeCdnUpdatePlan(plan, {
        baseUrl: onlineBaseUrl,
        currentVersion,
        targetVersion: catalog.targetVersion,
    })
    if (!needsUsbBase) return data
    return {
        ...data,
        info: { ...data.info, is_initial: !currentVersion },
        full: {
            version: usb.version,
            archive: usb.archives.map(archive => ({
                location: `${usb.baseUrl}/${archive.name}`,
                size: archive.size,
                sha256: archive.sha256,
            })),
        },
    }
}

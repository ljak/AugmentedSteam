import FAlternativeLinuxIcon from "../Common/FAlternativeLinuxIcon";
import FWishlistHighlights from "./FWishlistHighlights";
import FWishlistITADPrices from "./FWishlistITADPrices";
import FWishlistUserNotes from "./FWishlistUserNotes";
import FWishlistStats from "./FWishlistStats";
import FEmptyWishlist from "./FEmptyWishlist";
import FExportWishlist from "./FExportWishlist";
import FKeepEditableRanking from "./FKeepEditableRanking";
import FWishlistProfileLink from "./FWishlistProfileLink";
import ContextType from "@Content/Modules/Context/ContextType";
import ASEventHandler from "@Content/Modules/ASEventHandler";
import Context, {type ContextParams} from "@Content/Modules/Context/Context";
import SteamFacade from "@Content/Modules/Facades/SteamFacade";
import {WishlistDOM} from "@Content/Features/Store/Wishlist/Utils/WishlistDOM";
import WebRequestListener from "@Content/Modules/WebRequest/WebRequestListener";
import ServiceFactory from "@Protobufs/ServiceFactory";
import Long from "long";
import Settings from "@Options/Data/Settings";
import AugmentedSteamApiFacade from "@Content/Modules/Facades/AugmentedSteamApiFacade";
import type { TStorePageData } from "@Background/Modules/AugmentedSteam/_types";
import WishlistHLTBDisplay from "./Components/WishlistHLTBDisplay.svelte";
import WishlistButton from "./Components/WishlistButton.svelte";
import { getMenuNode } from "./Components/WishlistMenu"; // Corrected path
import { L } from "@Core/Localization/Localization";
import { __sort_by_hltb } from "@Strings/_strings";

export interface WishlistEntry {
    appid: number,
    priority: number,
    added: number,
    hltbMainStoryTime: number | null;
}

export default class CWishlist extends Context {

    public readonly onReorder: ASEventHandler<void> = new ASEventHandler<void>();

    public readonly dom: WishlistDOM;
    public readonly ownerId: string;

    public wishlistData: WishlistEntry[];
    private hltbComponentInstances: Map<number, WishlistHLTBDisplay> = new Map();
    private hltbSortOrder: 'asc' | 'desc' | null = null;

    static override async create(params: ContextParams): Promise<CWishlist> {

        const queryData: {
            queries: Array<{
                state: Record<string, any>,
                queryKey: Array<any>
            }>
        } = JSON.parse(await SteamFacade.global("SSR.renderContext.queryData"));

        let ownerId: string|null = null;
        let wishlistData: WishlistEntry[]|null = null;

        for (let query of queryData.queries) {
            if (query.queryKey[0] === "WishlistSortedFiltered") {
                ownerId = query.state.data.steamid;
                // wishlistData = query.state.data.items; // Old line
                wishlistData = query.state.data.items.map((item: any) => ({ // Added type for item
                    ...item,
                    hltbMainStoryTime: null
                }));
            }
        }

        if (!ownerId || !wishlistData) {
            throw new Error("Couldn't initialize wishlist, didn't find owner");
        }

        return new CWishlist(params, ownerId, wishlistData);
    }

    /* TODO private */ constructor(params: ContextParams, ownerId: string, wishlistData: WishlistEntry[]) {
        super(params, ContextType.WISHLIST, [
            FAlternativeLinuxIcon,
            FWishlistHighlights,
            FWishlistITADPrices,
            FWishlistUserNotes,
            FWishlistStats,
            FEmptyWishlist,
            FExportWishlist,
            FKeepEditableRanking,
            FWishlistProfileLink,
        ]);

        this.ownerId = ownerId;
        this.wishlistData = wishlistData;
        this.dom = new WishlistDOM();

        WebRequestListener.onComplete("reorder", ["https://store.steampowered.com/wishlist/action/reorder"],
            async (_url: string) => {
                await this.reloadWishlistData();
                this.onReorder.dispatch();
            });

        this.dom.observe();
        this.populateInitialHltbData(); // Added call

        // Determine a position; existing "Stats" button uses getTarget(3)
        // Let's try to place it after that, e.g., position 4.
        // This might need adjustment based on other menu items.
        const hltbSortButtonTargetPosition = 4; 

        try {
            const menuNode = getMenuNode();
            if (menuNode) {
                const hltbSortButton = new WishlistButton({
                    target: menuNode.getTarget(hltbSortButtonTargetPosition),
                    props: {
                        label: L(__sort_by_hltb) 
                    }
                });

                hltbSortButton.$on("click", () => {
                    this.sortWishlistByHLTB();
                });
            } else {
                console.error("Wishlist menu node not found, cannot add HLTB sort button.");
            }
        } catch (error) {
            console.error("Error adding HLTB sort button:", error);
        }
    }

    public get isMyWishlist(): boolean {
        return this.ownerId === this.user.steamId;
    }

    private async reloadWishlistData(): Promise<void> {
        const wishlist = await ServiceFactory.WishlistService(this.user).getWishlist({
            steamid: Long.fromString(this.ownerId!)
        });
        this.wishlistData = wishlist.items.map(item => {
            return {
                appid: item.appid!,
                priority: item.priority!,
                added: item.dateAdded!,
                hltbMainStoryTime: null // Initialize here
            }
        });

        for (const entry of this.wishlistData) {
            if (!Settings.showhltb) {
                entry.hltbMainStoryTime = null;
                continue;
            }

            try {
                // Ensure entry.appid is a number. If it's from an external source and could be a string, parse it.
                const appid = Number(entry.appid); 
                if (isNaN(appid)) {
                    console.warn(`Invalid appid for HLTB fetch: ${entry.appid}`);
                    entry.hltbMainStoryTime = null;
                    continue;
                }

                const storePageData: TStorePageData | null = await AugmentedSteamApiFacade.getStorePageData(appid);
                if (storePageData && storePageData.hltb && storePageData.hltb.story) {
                    entry.hltbMainStoryTime = storePageData.hltb.story;
                } else {
                    entry.hltbMainStoryTime = null;
                }
            } catch (error) {
                console.error(`Error fetching HLTB data for appid ${entry.appid}:`, error);
                entry.hltbMainStoryTime = null;
            }
        }
    }

    private async _fetchAndPopulateHltbData(): Promise<void> {
        for (const entry of this.wishlistData) {
            if (!Settings.showhltb) {
                entry.hltbMainStoryTime = null;
                continue;
            }

            try {
                const appid = Number(entry.appid);
                if (isNaN(appid)) {
                    console.warn(`Invalid appid for HLTB fetch: ${entry.appid}`);
                    entry.hltbMainStoryTime = null;
                    continue;
                }

                const storePageData: TStorePageData | null = await AugmentedSteamApiFacade.getStorePageData(appid);
                if (storePageData && storePageData.hltb && storePageData.hltb.story) {
                    entry.hltbMainStoryTime = storePageData.hltb.story;
                } else {
                    entry.hltbMainStoryTime = null;
                }
            } catch (error) {
                console.error(`Error fetching HLTB data for appid ${entry.appid}:`, error);
                entry.hltbMainStoryTime = null;
            }
        }
    }

    private async populateInitialHltbData(): Promise<void> {
        await this._fetchAndPopulateHltbData();
        this._renderHltbData(); // Added call
    }

    public sortWishlistByHLTB(): void {
        if (this.hltbSortOrder === null || this.hltbSortOrder === 'desc') {
            this.hltbSortOrder = 'asc';
        } else {
            this.hltbSortOrder = 'desc';
        }

        this.wishlistData.sort((a, b) => {
            const aTime = a.hltbMainStoryTime;
            const bTime = b.hltbMainStoryTime;

            // Handle null or non-positive HLTB times by grouping them at the end
            if (aTime === null || aTime <= 0) return 1;
            if (bTime === null || bTime <= 0) return -1;

            if (this.hltbSortOrder === 'asc') {
                return aTime - bTime;
            } else { // 'desc'
                return bTime - aTime;
            }
        });

        const gameListContainer = this.dom.dom.gameList?.node;
        if (!gameListContainer) {
            console.error("Wishlist game list container not found. Cannot reorder DOM elements.");
            return;
        }

        const appidToNodeMap = new Map<number, HTMLElement>();
        if (this.dom.dom.gameList?.games) {
            for (const domGame of this.dom.dom.gameList.games) {
                if (domGame.appid) {
                    appidToNodeMap.set(domGame.appid.toInt(), domGame.node);
                }
            }
        }

        for (const entry of this.wishlistData) {
            const nodeToMove = appidToNodeMap.get(entry.appid);
            if (nodeToMove) {
                gameListContainer.appendChild(nodeToMove);
            }
        }

        this._renderHltbData(); // Re-render HLTB components if needed
        // Not calling this.onReorder.dispatch() for now, as it's for API-driven reorders.
    }

    private _renderHltbData(): void {
        if (!this.dom.dom.gameList?.games) {
            return;
        }

        for (const domGame of this.dom.dom.gameList.games) {
            if (!domGame.appid) {
                continue;
            }

            const appidInt = domGame.appid.toInt();
            const wishlistEntry = this.wishlistData.find(entry => entry.appid === appidInt);

            const gameNode = domGame.node; // This is .LSY1zV2DJSM-
            if (!gameNode) continue;

            let hltbContainer = gameNode.querySelector<HTMLElement>('.as_hltb_wishlist_container');

            if (!wishlistEntry || wishlistEntry.hltbMainStoryTime === null) {
                const existingInstance = this.hltbComponentInstances.get(appidInt);
                if (existingInstance) {
                    existingInstance.$set({ hltbMainStoryTime: null });
                } else if (hltbContainer) {
                    // If a container exists but no component, and time is null, ensure it's empty or remove?
                    // For now, the component handles null by showing '-', so this branch might not be strictly needed
                    // if we always ensure a component is mounted.
                }
                continue;
            }

            if (!hltbContainer) {
                hltbContainer = document.createElement('div');
                hltbContainer.classList.add('as_hltb_wishlist_container');
                
                const titleAnchor = gameNode.querySelector<HTMLAnchorElement>("a.Fuz2JeT4RfI-");
                if (titleAnchor && titleAnchor.parentElement) {
                    // Insert after the div that contains the title and other elements like review score
                    const detailsDiv = titleAnchor.closest('.StoreSaleWidgetHalfLeft');
                    if (detailsDiv) {
                        detailsDiv.appendChild(hltbContainer);
                    } else {
                         // Fallback: append to gameNode if title area not found
                        gameNode.appendChild(hltbContainer);
                    }
                } else {
                    // Fallback: append to gameNode if title area not found
                    gameNode.appendChild(hltbContainer);
                }
            }

            const existingInstance = this.hltbComponentInstances.get(appidInt);
            if (existingInstance) {
                existingInstance.$set({ hltbMainStoryTime: wishlistEntry.hltbMainStoryTime });
            } else {
                const newInstance = new WishlistHLTBDisplay({
                    target: hltbContainer,
                    props: { hltbMainStoryTime: wishlistEntry.hltbMainStoryTime }
                });
                this.hltbComponentInstances.set(appidInt, newInstance);
            }
        }
    }
}

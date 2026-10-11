import { XMLBuilder } from "fast-xml-parser";
const builder = new XMLBuilder({ ignoreAttributes: true });
export function xmlResponse(call, payload = {}) {
  return new Response(builder.build({ [`${call}Response`]: { Ack: "Success", ...payload } }), {
    headers: { "Content-Type": "text/xml" },
  });
}
export function sellerPage(items, page = 1, total = items.length) {
  return xmlResponse("GetMyeBaySelling", {
    ActiveList: {
      ItemArray: { Item: items },
      PaginationResult: { TotalNumberOfPages: Math.ceil(total / 200), TotalNumberOfEntries: total },
    },
  });
}
export function sellerItem(id, title = "Art canvas", extra = {}) {
  return {
    ItemID: String(id),
    Title: title,
    PictureDetails: { GalleryURL: "https://i.ebayimg.com/images/test.jpg" },
    QuantityAvailable: "1",
    ...extra,
  };
}

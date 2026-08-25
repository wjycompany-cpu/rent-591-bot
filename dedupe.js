// ============================================
// 物件去重
// ============================================
// 591 上同一間房子常被重複刊登：同一個仲介連貼三次，或不同仲介各貼一次。
// 每次刊登都是獨立的物件ID，所以單看 ID 無法辨識。
//
// 仲介也會靠「重新刊登」把物件推回列表最前面，重刊同樣會產生新的 ID。
// 因此去重必須跨執行有效，複合鍵要和 ID 一起存進已發送記錄。

/**
 * 產生物件的識別鍵。
 * 用社區、租金、坪數、格局、樓層組合而成——同一棟樓的不同戶樓層必然不同，
 * 把樓層納入可避免把兩戶不同的房子誤判為同一間。
 * 代價是 591 樓層資料不一致時會漏抓（例如同一戶一次寫 28F、一次寫頂樓加蓋），
 * 但「漏抓」只是多推播一次，比「誤合」讓你少看到一間房子安全。
 */
function listingKey(item) {
  const parts = [
    item.community || '',
    item.price || '',
    item.area || '',
    item.layout || '',
    item.floor || '',
  ].map((v) => String(v).trim());

  // 社區為空時無法可靠比對（多為透天、公寓），退回用物件ID，等於不去重
  if (!parts[0]) return `id:${item.id}`;

  return `key:${parts.join('|')}`;
}

/**
 * 從物件清單中濾掉重複者。
 * 同時處理兩種情況：與歷史記錄重複、以及同一批內部重複。
 *
 * @param {Array} listings 本次抓到的物件
 * @param {Set} seen 已發送記錄（同時含物件ID與複合鍵）
 * @returns {{ fresh: Array, skipped: Array }}
 */
function filterDuplicates(listings, seen) {
  const fresh = [];
  const skipped = [];
  const batchKeys = new Set(); // 本批已出現過的鍵，擋同一次抓取內的重複

  for (const item of listings) {
    const id = String(item.id || '');
    const key = listingKey(item);

    if (!id) continue;

    if (seen.has(id)) {
      skipped.push({ item, reason: '已推播過（相同物件ID）' });
    } else if (seen.has(key)) {
      skipped.push({ item, reason: '已推播過（同一物件重新刊登）' });
    } else if (batchKeys.has(key)) {
      skipped.push({ item, reason: '本次抓取內重複刊登' });
    } else {
      batchKeys.add(key);
      fresh.push(item);
    }
  }

  return { fresh, skipped };
}

/**
 * 把已推播的物件記進記錄集合（ID 與複合鍵都要記）
 */
function remember(seen, listings) {
  for (const item of listings) {
    seen.add(String(item.id));
    seen.add(listingKey(item));
  }
  return seen;
}

module.exports = { listingKey, filterDuplicates, remember };

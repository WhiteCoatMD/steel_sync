import { describe, it, expect } from 'vitest';
import { quoteFromTable } from '../manufacturer/engine';
import type { ManufacturerTable } from '../manufacturer/types';
import tableJson from '../data/tejasmex.json';

const table = tableJson as unknown as ManufacturerTable;

/**
 * Every row is a price read off design.tejasmex.com/?dealer=Columbia with a
 * scripted driver, on a build with every door and window cleared. They are
 * written down rather than derived: a test that recomputes its expectation from
 * the same table it is checking cannot fail.
 *
 * HOW THESE WERE TAKEN, because it is easy to take them wrongly:
 *
 *  - Openings are cleared until the count of `component` paths in the store's
 *    options.present.selections reaches ZERO. Waiting for the total to settle
 *    is not enough -- two clearing passes that miss the same wall agree with
 *    each other while a $900 roll-up door is still on the building, and that
 *    produced a whole voided round of measurements.
 *  - Each (width, leg height) is a fresh page swept over one axis only, with a
 *    value re-read at the end to prove the sweep did not drift.
 *  - Never two probe browsers at once. The clearing pass is driven by
 *    wall-clock sleeps, so contention makes it miss walls silently.
 *
 * THE CERTIFIED COLUMN MATTERS. The vendor page defaults to CERTIFIED
 * (certified-140mph-30-20), so a reading taken from its default carries a
 * certification line and has to be compared with engineered: true. Our product
 * defaults the other way -- engineered is false unless a customer asks for a
 * stamped building -- so the non-certified rows below were measured separately
 * with certification switched off, to check the path customers actually get
 * rather than assume it follows.
 *
 * Getting this backwards is a trap that already cost a session: comparing a
 * certified vendor reading against engineered: false makes every quote look
 * $405 light, which is 450 x 0.9 -- the certification with the vendor's -10%
 * width surcharge on it. A plain carport has no walls, which is the only reason
 * that was caught before being folded into a wall price.
 *
 * The depth column is the ENCLOSED depth: 0 is a plain carport, a depth equal
 * to the length is a full garage, and anything between is a combo.
 *
 * See docs/superpowers/notes/2026-09-04-combo-pricing-verification.md.
 */
type Row = [number, number, number, number, 'horizontal' | 'vertical', boolean, number];
const MEASURED: Row[] = [
  [20, 30, 9, 0, 'horizontal', false, 3381], // carport
  [24, 30, 9, 30, 'horizontal', false, 7622], // garage
  [20, 25, 9, 25, 'vertical', false, 8039], // garage
  [12, 30, 6, 30, 'horizontal', true, 4763], // garage
  [12, 30, 7, 30, 'horizontal', true, 5137], // garage
  [12, 30, 8, 30, 'horizontal', true, 5419], // garage
  [12, 30, 9, 30, 'horizontal', true, 5782], // garage
  [12, 30, 9, 30, 'horizontal', true, 5782], // garage
  [12, 30, 10, 30, 'horizontal', true, 6161], // garage
  [12, 30, 11, 30, 'horizontal', true, 6625], // garage
  [12, 30, 12, 30, 'horizontal', true, 7231], // garage
  [14, 30, 6, 30, 'horizontal', true, 5248], // garage
  [14, 30, 7, 30, 'horizontal', true, 5660], // garage
  [14, 30, 8, 30, 'horizontal', true, 5888], // garage
  [14, 30, 9, 30, 'horizontal', true, 6277], // garage
  [14, 30, 9, 30, 'horizontal', true, 6277], // garage
  [14, 30, 10, 30, 'horizontal', true, 6630], // garage
  [14, 30, 11, 30, 'horizontal', true, 7158], // garage
  [14, 30, 12, 30, 'horizontal', true, 7884], // garage
  [16, 30, 6, 30, 'horizontal', true, 5248], // garage
  [16, 30, 7, 30, 'horizontal', true, 5660], // garage
  [16, 30, 8, 30, 'horizontal', true, 5888], // garage
  [16, 30, 9, 30, 'horizontal', true, 6277], // garage
  [16, 30, 9, 30, 'horizontal', true, 6277], // garage
  [16, 30, 10, 30, 'horizontal', true, 6630], // garage
  [16, 30, 11, 30, 'horizontal', true, 7158], // garage
  [16, 30, 12, 30, 'horizontal', true, 7884], // garage
  [18, 30, 6, 30, 'horizontal', true, 5248], // garage
  [18, 30, 7, 30, 'horizontal', true, 5660], // garage
  [18, 30, 8, 30, 'horizontal', true, 5888], // garage
  [18, 25, 9, 25, 'horizontal', true, 5495], // garage
  [18, 30, 9, 30, 'horizontal', true, 6277], // garage
  [18, 30, 9, 30, 'horizontal', true, 6277], // garage
  [18, 30, 10, 30, 'horizontal', true, 6630], // garage
  [18, 30, 11, 30, 'horizontal', true, 7158], // garage
  [18, 30, 12, 30, 'horizontal', true, 7884], // garage
  [20, 30, 6, 5, 'horizontal', true, 5109], // combo
  [20, 30, 6, 10, 'horizontal', true, 5253], // combo
  [20, 30, 6, 15, 'horizontal', true, 5383], // combo
  [20, 30, 6, 20, 'horizontal', true, 5429], // combo
  [20, 20, 6, 20, 'horizontal', true, 4380], // garage
  [20, 30, 6, 25, 'horizontal', true, 5493], // combo
  [20, 25, 6, 25, 'horizontal', true, 5011], // garage
  [20, 30, 6, 30, 'horizontal', true, 5573], // garage
  [20, 35, 6, 35, 'horizontal', true, 6368], // garage
  [20, 40, 6, 40, 'horizontal', true, 7078], // garage
  [20, 45, 6, 45, 'horizontal', true, 7865], // garage
  [20, 50, 6, 50, 'horizontal', true, 8498], // garage
  [20, 55, 6, 55, 'horizontal', true, 9058], // garage
  [20, 60, 6, 60, 'horizontal', true, 9619], // garage
  [20, 30, 7, 5, 'horizontal', true, 5511], // combo
  [20, 30, 7, 10, 'horizontal', true, 5667], // combo
  [20, 30, 7, 15, 'horizontal', true, 5803], // combo
  [20, 30, 7, 20, 'horizontal', true, 5767], // combo
  [20, 20, 7, 20, 'horizontal', true, 4682], // garage
  [20, 30, 7, 25, 'horizontal', true, 5857], // combo
  [20, 25, 7, 25, 'horizontal', true, 5357], // garage
  [20, 30, 7, 30, 'horizontal', true, 5947], // garage
  [20, 35, 7, 35, 'horizontal', true, 6754], // garage
  [20, 40, 7, 40, 'horizontal', true, 7476], // garage
  [20, 45, 7, 45, 'horizontal', true, 8379], // garage
  [20, 50, 7, 50, 'horizontal', true, 9054], // garage
  [20, 55, 7, 55, 'horizontal', true, 9646], // garage
  [20, 60, 7, 60, 'horizontal', true, 10237], // garage
  [20, 30, 8, 5, 'horizontal', true, 5721], // combo
  [20, 30, 8, 10, 'horizontal', true, 5877], // combo
  [20, 30, 8, 15, 'horizontal', true, 6013], // combo
  [20, 30, 8, 20, 'horizontal', true, 6067], // combo
  [20, 30, 8, 25, 'horizontal', true, 6151], // combo
  [20, 30, 9, 0, 'horizontal', true, 3786], // carport
  [20, 30, 9, 5, 'horizontal', true, 6038], // combo
  [20, 30, 9, 10, 'horizontal', true, 6194], // combo
  [20, 30, 9, 15, 'horizontal', true, 6330], // combo
  [20, 30, 9, 20, 'horizontal', true, 6436], // combo
  [20, 30, 9, 25, 'horizontal', true, 6540], // combo
  [20, 30, 9, 30, 'horizontal', true, 6644], // garage
  [20, 30, 10, 5, 'horizontal', true, 6429], // combo
  [20, 30, 10, 10, 'horizontal', true, 6677], // combo
  [20, 30, 10, 15, 'horizontal', true, 6971], // combo
  [20, 30, 10, 20, 'horizontal', true, 6853], // combo
  [20, 30, 10, 25, 'horizontal', true, 6971], // combo
  [20, 30, 11, 5, 'horizontal', true, 6821], // combo
  [20, 30, 11, 10, 'horizontal', true, 7069], // combo
  [20, 30, 11, 15, 'horizontal', true, 7363], // combo
  [20, 30, 11, 20, 'horizontal', true, 7355], // combo
  [20, 30, 11, 25, 'horizontal', true, 7487], // combo
  [20, 20, 12, 0, 'horizontal', true, 2802], // carport
  [20, 30, 12, 0, 'horizontal', true, 4112], // carport
  [20, 40, 12, 0, 'horizontal', true, 5682], // carport
  [20, 30, 12, 5, 'horizontal', true, 7499], // combo
  [20, 30, 12, 10, 'horizontal', true, 7747], // combo
  [20, 30, 12, 15, 'horizontal', true, 8041], // combo
  [20, 20, 12, 20, 'horizontal', true, 6789], // garage
  [20, 30, 12, 20, 'horizontal', true, 8125], // combo
  [20, 20, 12, 20, 'horizontal', true, 6789], // garage
  [20, 30, 12, 25, 'horizontal', true, 8197], // combo
  [20, 25, 12, 25, 'horizontal', true, 7610], // garage
  [20, 30, 12, 30, 'horizontal', true, 8393], // garage
  [20, 30, 12, 30, 'horizontal', true, 8393], // garage
  [20, 35, 12, 35, 'horizontal', true, 9527], // garage
  [20, 40, 12, 40, 'horizontal', true, 10477], // garage
  [20, 40, 12, 40, 'horizontal', true, 10477], // garage
  [20, 45, 12, 45, 'horizontal', true, 11645], // garage
  [20, 50, 12, 50, 'horizontal', true, 12467], // garage
  [20, 55, 12, 55, 'horizontal', true, 13249], // garage
  [20, 60, 12, 60, 'horizontal', true, 14030], // garage
  [22, 30, 6, 30, 'horizontal', true, 6435], // garage
  [22, 30, 7, 30, 'horizontal', true, 6859], // garage
  [22, 30, 8, 30, 'horizontal', true, 7129], // garage
  [22, 30, 9, 30, 'horizontal', true, 7530], // garage
  [22, 30, 9, 30, 'horizontal', true, 7530], // garage
  [22, 30, 10, 30, 'horizontal', true, 7961], // garage
  [22, 30, 11, 30, 'horizontal', true, 8607], // garage
  [22, 30, 12, 30, 'horizontal', true, 9137], // garage
  [24, 20, 6, 20, 'horizontal', true, 5294], // garage
  [24, 25, 6, 25, 'horizontal', true, 5925], // garage
  [24, 30, 6, 30, 'horizontal', true, 6878], // garage
  [24, 35, 6, 35, 'horizontal', true, 7674], // garage
  [24, 40, 6, 40, 'horizontal', true, 8514], // garage
  [24, 45, 6, 45, 'horizontal', true, 9301], // garage
  [24, 50, 6, 50, 'horizontal', true, 9934], // garage
  [24, 55, 6, 55, 'horizontal', true, 10885], // garage
  [24, 60, 6, 60, 'horizontal', true, 11838], // garage
  [24, 20, 7, 20, 'horizontal', true, 5646], // garage
  [24, 25, 7, 25, 'horizontal', true, 6321], // garage
  [24, 30, 7, 30, 'horizontal', true, 7302], // garage
  [24, 35, 7, 35, 'horizontal', true, 8110], // garage
  [24, 40, 7, 40, 'horizontal', true, 8962], // garage
  [24, 45, 7, 45, 'horizontal', true, 9865], // garage
  [24, 50, 7, 50, 'horizontal', true, 10540], // garage
  [24, 55, 7, 55, 'horizontal', true, 11523], // garage
  [24, 60, 7, 60, 'horizontal', true, 12506], // garage
  [24, 20, 8, 20, 'horizontal', true, 5948], // garage
  [24, 25, 8, 25, 'horizontal', true, 6617], // garage
  [24, 30, 8, 30, 'horizontal', true, 7612], // garage
  [24, 35, 8, 35, 'horizontal', true, 8394], // garage
  [24, 40, 8, 40, 'horizontal', true, 9240], // garage
  [24, 45, 8, 45, 'horizontal', true, 10305], // garage
  [24, 50, 8, 50, 'horizontal', true, 10976], // garage
  [24, 55, 8, 55, 'horizontal', true, 11971], // garage
  [24, 60, 8, 60, 'horizontal', true, 12966], // garage
  [24, 30, 9, 5, 'horizontal', true, 7421], // combo
  [24, 30, 9, 10, 'horizontal', true, 7577], // combo
  [24, 30, 9, 15, 'horizontal', true, 7713], // combo
  [24, 30, 9, 20, 'horizontal', true, 7819], // combo
  [24, 20, 9, 20, 'horizontal', true, 6248], // garage
  [24, 21, 9, 21, 'horizontal', true, 6939], // garage
  [24, 22, 9, 22, 'horizontal', true, 6984], // garage
  [24, 23, 9, 23, 'horizontal', true, 6984], // garage
  [24, 30, 9, 25, 'horizontal', true, 7923], // combo
  [24, 25, 9, 25, 'horizontal', true, 6984], // garage
  [24, 30, 9, 30, 'horizontal', true, 8027], // garage
  [24, 30, 9, 30, 'horizontal', true, 8027], // garage
  [24, 35, 9, 35, 'horizontal', true, 8919], // garage
  [24, 40, 9, 40, 'horizontal', true, 9792], // garage
  [24, 45, 9, 45, 'horizontal', true, 10802], // garage
  [24, 50, 9, 50, 'horizontal', true, 11540], // garage
  [24, 55, 9, 55, 'horizontal', true, 12583], // garage
  [24, 60, 9, 60, 'horizontal', true, 13626], // garage
  [24, 20, 10, 20, 'horizontal', true, 6691], // garage
  [24, 25, 10, 25, 'horizontal', true, 7468], // garage
  [24, 30, 10, 30, 'horizontal', true, 8548], // garage
  [24, 35, 10, 35, 'horizontal', true, 9482], // garage
  [24, 40, 10, 40, 'horizontal', true, 10458], // garage
  [24, 45, 10, 45, 'horizontal', true, 11431], // garage
  [24, 50, 10, 50, 'horizontal', true, 12206], // garage
  [24, 55, 10, 55, 'horizontal', true, 13288], // garage
  [24, 60, 10, 60, 'horizontal', true, 14368], // garage
  [24, 20, 11, 20, 'horizontal', true, 7245], // garage
  [24, 25, 11, 25, 'horizontal', true, 8048], // garage
  [24, 30, 11, 30, 'horizontal', true, 9208], // garage
  [24, 35, 11, 35, 'horizontal', true, 10147], // garage
  [24, 40, 11, 40, 'horizontal', true, 11137], // garage
  [24, 45, 11, 45, 'horizontal', true, 12187], // garage
  [24, 50, 11, 50, 'horizontal', true, 12990], // garage
  [24, 55, 11, 55, 'horizontal', true, 14150], // garage
  [24, 60, 11, 60, 'horizontal', true, 15309], // garage
  [24, 20, 12, 20, 'horizontal', true, 8015], // garage
  [24, 25, 12, 25, 'horizontal', true, 8836], // garage
  [24, 30, 12, 30, 'horizontal', true, 10010], // garage
  [24, 35, 12, 35, 'horizontal', true, 11145], // garage
  [24, 40, 12, 40, 'horizontal', true, 12225], // garage
  [24, 45, 12, 45, 'horizontal', true, 13393], // garage
  [24, 50, 12, 50, 'horizontal', true, 14215], // garage
  [24, 55, 12, 55, 'horizontal', true, 15388], // garage
  [24, 60, 12, 60, 'horizontal', true, 16561], // garage
  [26, 30, 6, 30, 'horizontal', true, 8828], // garage
  [26, 30, 7, 30, 'horizontal', true, 9215], // garage
  [26, 30, 8, 30, 'horizontal', true, 9861], // garage
  [26, 25, 9, 25, 'horizontal', true, 8974], // garage
  [26, 30, 9, 30, 'horizontal', true, 10290], // garage
  [26, 30, 9, 30, 'horizontal', true, 10290], // garage
  [26, 30, 10, 30, 'horizontal', true, 10766], // garage
  [26, 30, 11, 30, 'horizontal', true, 11255], // garage
  [26, 30, 12, 30, 'horizontal', true, 14891], // garage
  [28, 30, 6, 30, 'horizontal', true, 9363], // garage
  [28, 30, 7, 30, 'horizontal', true, 9842], // garage
  [28, 30, 8, 30, 'horizontal', true, 10422], // garage
  [28, 30, 9, 30, 'horizontal', true, 10889], // garage
  [28, 30, 9, 30, 'horizontal', true, 10889], // garage
  [28, 30, 10, 30, 'horizontal', true, 11367], // garage
  [28, 30, 11, 30, 'horizontal', true, 11934], // garage
  [28, 30, 12, 30, 'horizontal', true, 15530], // garage
  [30, 30, 6, 5, 'horizontal', true, 9318], // combo
  [30, 30, 6, 10, 'horizontal', true, 9462], // combo
  [30, 30, 6, 15, 'horizontal', true, 9592], // combo
  [30, 30, 6, 20, 'horizontal', true, 9658], // combo
  [30, 20, 6, 20, 'horizontal', true, 7696], // garage
  [30, 30, 6, 25, 'horizontal', true, 9718], // combo
  [30, 25, 6, 25, 'horizontal', true, 8649], // garage
  [30, 30, 6, 30, 'horizontal', true, 9846], // garage
  [30, 35, 6, 35, 'horizontal', true, 10948], // garage
  [30, 40, 6, 40, 'horizontal', true, 12232], // garage
  [30, 45, 6, 45, 'horizontal', true, 13054], // garage
  [30, 50, 6, 50, 'horizontal', true, 14007], // garage
  [30, 55, 6, 55, 'horizontal', true, 15206], // garage
  [30, 60, 6, 60, 'horizontal', true, 16405], // garage
  [30, 30, 7, 5, 'horizontal', true, 9835], // combo
  [30, 30, 7, 10, 'horizontal', true, 9991], // combo
  [30, 30, 7, 15, 'horizontal', true, 10127], // combo
  [30, 30, 7, 20, 'horizontal', true, 10075], // combo
  [30, 20, 7, 20, 'horizontal', true, 8068], // garage
  [30, 30, 7, 25, 'horizontal', true, 10195], // combo
  [30, 25, 7, 25, 'horizontal', true, 9107], // garage
  [30, 30, 7, 30, 'horizontal', true, 10299], // garage
  [30, 35, 7, 35, 'horizontal', true, 11498], // garage
  [30, 40, 7, 40, 'horizontal', true, 12796], // garage
  [30, 45, 7, 45, 'horizontal', true, 13676], // garage
  [30, 50, 7, 50, 'horizontal', true, 14713], // garage
  [30, 55, 7, 55, 'horizontal', true, 15907], // garage
  [30, 60, 7, 60, 'horizontal', true, 17099], // garage
  [30, 30, 8, 5, 'horizontal', true, 10207], // combo
  [30, 30, 8, 10, 'horizontal', true, 10363], // combo
  [30, 30, 8, 15, 'horizontal', true, 10499], // combo
  [30, 30, 8, 20, 'horizontal', true, 10499], // combo
  [30, 20, 8, 20, 'horizontal', true, 8445], // garage
  [30, 30, 8, 25, 'horizontal', true, 10683], // combo
  [30, 25, 8, 25, 'horizontal', true, 9574], // garage
  [30, 30, 8, 30, 'horizontal', true, 10879], // garage
  [30, 35, 8, 35, 'horizontal', true, 12040], // garage
  [30, 40, 8, 40, 'horizontal', true, 13388], // garage
  [30, 45, 8, 45, 'horizontal', true, 14314], // garage
  [30, 50, 8, 50, 'horizontal', true, 15441], // garage
  [30, 55, 8, 55, 'horizontal', true, 16748], // garage
  [30, 60, 8, 60, 'horizontal', true, 18052], // garage
  [30, 30, 9, 5, 'horizontal', true, 10592], // combo
  [30, 30, 9, 10, 'horizontal', true, 10748], // combo
  [30, 30, 9, 15, 'horizontal', true, 10884], // combo
  [30, 30, 9, 20, 'horizontal', true, 10976], // combo
  [30, 20, 9, 20, 'horizontal', true, 8865], // garage
  [30, 30, 9, 25, 'horizontal', true, 11146], // combo
  [30, 25, 9, 25, 'horizontal', true, 10006], // garage
  [30, 30, 9, 30, 'horizontal', true, 11322], // garage
  [30, 35, 9, 35, 'horizontal', true, 12542], // garage
  [30, 40, 9, 40, 'horizontal', true, 13904], // garage
  [30, 45, 9, 45, 'horizontal', true, 14954], // garage
  [30, 50, 9, 50, 'horizontal', true, 16095], // garage
  [30, 55, 9, 55, 'horizontal', true, 17411], // garage
  [30, 60, 9, 60, 'horizontal', true, 18727], // garage
  [30, 30, 10, 5, 'horizontal', true, 11120], // combo
  [30, 30, 10, 10, 'horizontal', true, 11368], // combo
  [30, 30, 10, 15, 'horizontal', true, 11662], // combo
  [30, 30, 10, 20, 'horizontal', true, 11524], // combo
  [30, 20, 10, 20, 'horizontal', true, 9366], // garage
  [30, 30, 10, 25, 'horizontal', true, 11792], // combo
  [30, 25, 10, 25, 'horizontal', true, 10631], // garage
  [30, 30, 10, 30, 'horizontal', true, 11902], // garage
  [30, 35, 10, 35, 'horizontal', true, 13173], // garage
  [30, 40, 10, 40, 'horizontal', true, 14645], // garage
  [30, 45, 10, 45, 'horizontal', true, 15770], // garage
  [30, 50, 10, 50, 'horizontal', true, 17035], // garage
  [30, 55, 10, 55, 'horizontal', true, 18306], // garage
  [30, 60, 10, 60, 'horizontal', true, 19577], // garage
  [30, 30, 11, 5, 'horizontal', true, 11499], // combo
  [30, 30, 11, 10, 'horizontal', true, 11747], // combo
  [30, 30, 11, 15, 'horizontal', true, 12041], // combo
  [30, 30, 11, 20, 'horizontal', true, 12001], // combo
  [30, 20, 11, 20, 'horizontal', true, 9792], // garage
  [30, 30, 11, 25, 'horizontal', true, 12277], // combo
  [30, 25, 11, 25, 'horizontal', true, 11091], // garage
  [30, 30, 11, 30, 'horizontal', true, 12419], // garage
  [30, 35, 11, 35, 'horizontal', true, 13737], // garage
  [30, 40, 11, 40, 'horizontal', true, 15262], // garage
  [30, 45, 11, 45, 'horizontal', true, 16444], // garage
  [30, 50, 11, 50, 'horizontal', true, 17741], // garage
  [30, 55, 11, 55, 'horizontal', true, 19069], // garage
  [30, 60, 11, 60, 'horizontal', true, 20397], // garage
  [30, 30, 12, 0, 'horizontal', true, 6885], // carport
  [30, 30, 12, 5, 'horizontal', true, 15021], // combo
  [30, 30, 12, 10, 'horizontal', true, 15269], // combo
  [30, 30, 12, 15, 'horizontal', true, 15563], // combo
  [30, 30, 12, 20, 'horizontal', true, 15641], // combo
  [30, 20, 12, 20, 'horizontal', true, 13157], // garage
  [30, 30, 12, 25, 'horizontal', true, 15915], // combo
  [30, 25, 12, 25, 'horizontal', true, 14585], // garage
  [30, 30, 12, 30, 'horizontal', true, 16013], // garage
  [30, 35, 12, 35, 'horizontal', true, 17468], // garage
  [30, 40, 12, 40, 'horizontal', true, 19227], // garage
  [30, 45, 12, 45, 'horizontal', true, 20642], // garage
  [30, 50, 12, 50, 'horizontal', true, 22070], // garage
  [30, 55, 12, 55, 'horizontal', true, 23498], // garage
  [30, 60, 12, 60, 'horizontal', true, 24924], // garage
  [12, 30, 6, 30, 'vertical', true, 6953], // garage
  [12, 30, 7, 30, 'vertical', true, 7329], // garage
  [12, 30, 8, 30, 'vertical', true, 7611], // garage
  [12, 30, 9, 30, 'vertical', true, 7972], // garage
  [12, 30, 9, 30, 'vertical', true, 7972], // garage
  [12, 30, 10, 30, 'vertical', true, 8353], // garage
  [12, 30, 11, 30, 'vertical', true, 9109], // garage
  [12, 30, 12, 30, 'vertical', true, 9715], // garage
  [14, 30, 6, 30, 'vertical', true, 7696], // garage
  [14, 30, 7, 30, 'vertical', true, 8112], // garage
  [14, 30, 8, 30, 'vertical', true, 8342], // garage
  [14, 30, 9, 30, 'vertical', true, 8729], // garage
  [14, 30, 9, 30, 'vertical', true, 8729], // garage
  [14, 30, 10, 30, 'vertical', true, 9082], // garage
  [14, 30, 11, 30, 'vertical', true, 9904], // garage
  [14, 30, 12, 30, 'vertical', true, 10628], // garage
  [16, 30, 6, 30, 'vertical', true, 7696], // garage
  [16, 30, 7, 30, 'vertical', true, 8112], // garage
  [16, 30, 8, 30, 'vertical', true, 8342], // garage
  [16, 30, 9, 30, 'vertical', true, 8729], // garage
  [16, 30, 9, 30, 'vertical', true, 8729], // garage
  [16, 30, 10, 30, 'vertical', true, 9082], // garage
  [16, 30, 11, 30, 'vertical', true, 9904], // garage
  [16, 30, 12, 30, 'vertical', true, 10628], // garage
  [18, 30, 6, 30, 'vertical', true, 7696], // garage
  [18, 30, 7, 30, 'vertical', true, 8112], // garage
  [18, 30, 8, 30, 'vertical', true, 8342], // garage
  [18, 25, 9, 25, 'vertical', true, 7793], // garage
  [18, 30, 9, 30, 'vertical', true, 8729], // garage
  [18, 30, 9, 30, 'vertical', true, 8729], // garage
  [18, 30, 10, 30, 'vertical', true, 9082], // garage
  [18, 30, 11, 30, 'vertical', true, 9904], // garage
  [18, 30, 12, 30, 'vertical', true, 10628], // garage
  [20, 30, 6, 5, 'vertical', true, 7023], // combo
  [20, 30, 6, 10, 'vertical', true, 7167], // combo
  [20, 30, 6, 15, 'vertical', true, 7297], // combo
  [20, 20, 6, 20, 'vertical', true, 6588], // garage
  [20, 30, 6, 20, 'vertical', true, 7637], // combo
  [20, 25, 6, 25, 'vertical', true, 7375], // garage
  [20, 30, 6, 25, 'vertical', true, 7857], // combo
  [20, 30, 6, 30, 'vertical', true, 8089], // garage
  [20, 30, 6, 30, 'vertical', true, 8089], // garage
  [20, 35, 6, 35, 'vertical', true, 9040], // garage
  [20, 40, 6, 40, 'vertical', true, 9906], // garage
  [20, 45, 6, 45, 'vertical', true, 10883], // garage
  [20, 50, 6, 50, 'vertical', true, 11672], // garage
  [20, 55, 6, 55, 'vertical', true, 12656], // garage
  [20, 60, 6, 60, 'vertical', true, 13369], // garage
  [20, 30, 7, 5, 'vertical', true, 7423], // combo
  [20, 30, 7, 10, 'vertical', true, 7579], // combo
  [20, 30, 7, 15, 'vertical', true, 7715], // combo
  [20, 20, 7, 20, 'vertical', true, 6886], // garage
  [20, 30, 7, 20, 'vertical', true, 7971], // combo
  [20, 25, 7, 25, 'vertical', true, 7719], // garage
  [20, 30, 7, 25, 'vertical', true, 8219], // combo
  [20, 30, 7, 30, 'vertical', true, 8465], // garage
  [20, 35, 7, 35, 'vertical', true, 9426], // garage
  [20, 40, 7, 40, 'vertical', true, 10302], // garage
  [20, 45, 7, 45, 'vertical', true, 11395], // garage
  [20, 50, 7, 50, 'vertical', true, 12226], // garage
  [20, 55, 7, 55, 'vertical', true, 13242], // garage
  [20, 60, 7, 60, 'vertical', true, 13989], // garage
  [20, 30, 8, 5, 'vertical', true, 7633], // combo
  [20, 30, 8, 10, 'vertical', true, 7789], // combo
  [20, 30, 8, 15, 'vertical', true, 7925], // combo
  [20, 30, 8, 20, 'vertical', true, 8271], // combo
  [20, 30, 8, 25, 'vertical', true, 8513], // combo
  [20, 30, 9, 5, 'vertical', true, 7950], // combo
  [20, 30, 9, 10, 'vertical', true, 8106], // combo
  [20, 30, 9, 15, 'vertical', true, 8242], // combo
  [20, 30, 9, 20, 'vertical', true, 8640], // combo
  [20, 25, 9, 25, 'vertical', true, 8354], // garage
  [20, 30, 9, 25, 'vertical', true, 8902], // combo
  [20, 30, 9, 30, 'vertical', true, 9160], // garage
  [20, 30, 10, 5, 'vertical', true, 8341], // combo
  [20, 30, 10, 10, 'vertical', true, 8589], // combo
  [20, 30, 10, 15, 'vertical', true, 8883], // combo
  [20, 30, 10, 20, 'vertical', true, 9059], // combo
  [20, 30, 10, 25, 'vertical', true, 9331], // combo
  [20, 30, 11, 5, 'vertical', true, 8799], // combo
  [20, 30, 11, 10, 'vertical', true, 9047], // combo
  [20, 30, 11, 15, 'vertical', true, 9341], // combo
  [20, 30, 11, 20, 'vertical', true, 9791], // combo
  [20, 30, 11, 25, 'vertical', true, 10109], // combo
  [20, 30, 11, 30, 'vertical', true, 10453], // garage
  [20, 30, 12, 5, 'vertical', true, 9477], // combo
  [20, 30, 12, 10, 'vertical', true, 9725], // combo
  [20, 30, 12, 15, 'vertical', true, 10019], // combo
  [20, 20, 12, 20, 'vertical', true, 9225], // garage
  [20, 30, 12, 20, 'vertical', true, 10561], // combo
  [20, 25, 12, 25, 'vertical', true, 10232], // garage
  [20, 30, 12, 25, 'vertical', true, 10819], // combo
  [20, 30, 12, 30, 'vertical', true, 11203], // garage
  [20, 35, 12, 35, 'vertical', true, 12525], // garage
  [20, 40, 12, 40, 'vertical', true, 13663], // garage
  [20, 45, 12, 45, 'vertical', true, 15085], // garage
  [20, 50, 12, 50, 'vertical', true, 16093], // garage
  [20, 55, 12, 55, 'vertical', true, 17333], // garage
  [20, 60, 12, 60, 'vertical', true, 18302], // garage
  [22, 30, 6, 30, 'vertical', true, 9105], // garage
  [22, 30, 7, 30, 'vertical', true, 9535], // garage
  [22, 30, 8, 30, 'vertical', true, 9801], // garage
  [22, 30, 9, 30, 'vertical', true, 10202], // garage
  [22, 30, 9, 30, 'vertical', true, 10202], // garage
  [22, 30, 10, 30, 'vertical', true, 10635], // garage
  [22, 30, 11, 30, 'vertical', true, 11573], // garage
  [22, 30, 12, 30, 'vertical', true, 12101], // garage
  [24, 20, 6, 20, 'vertical', true, 7722], // garage
  [24, 25, 6, 25, 'vertical', true, 8509], // garage
  [24, 30, 6, 30, 'vertical', true, 9614], // garage
  [24, 35, 6, 35, 'vertical', true, 10566], // garage
  [24, 40, 6, 40, 'vertical', true, 11562], // garage
  [24, 45, 6, 45, 'vertical', true, 12539], // garage
  [24, 50, 6, 50, 'vertical', true, 13328], // garage
  [24, 55, 6, 55, 'vertical', true, 14703], // garage
  [24, 60, 6, 60, 'vertical', true, 15808], // garage
  [24, 60, 6, 60, 'vertical', true, 15808], // garage
  [24, 20, 7, 20, 'vertical', true, 8072], // garage
  [24, 25, 7, 25, 'vertical', true, 8905], // garage
  [24, 30, 7, 30, 'vertical', true, 10042], // garage
  [24, 35, 7, 35, 'vertical', true, 11004], // garage
  [24, 40, 7, 40, 'vertical', true, 12010], // garage
  [24, 45, 7, 45, 'vertical', true, 13103], // garage
  [24, 50, 7, 50, 'vertical', true, 13934], // garage
  [24, 55, 7, 55, 'vertical', true, 15341], // garage
  [24, 60, 7, 60, 'vertical', true, 16480], // garage
  [24, 20, 8, 20, 'vertical', true, 8372], // garage
  [24, 25, 8, 25, 'vertical', true, 9199], // garage
  [24, 30, 8, 30, 'vertical', true, 10348], // garage
  [24, 35, 8, 35, 'vertical', true, 11286], // garage
  [24, 40, 8, 40, 'vertical', true, 12286], // garage
  [24, 45, 8, 45, 'vertical', true, 13541], // garage
  [24, 50, 8, 50, 'vertical', true, 14368], // garage
  [24, 55, 8, 55, 'vertical', true, 15787], // garage
  [24, 60, 8, 60, 'vertical', true, 16938], // garage
  [24, 20, 9, 20, 'vertical', true, 8674], // garage
  [24, 21, 9, 21, 'vertical', true, 9523], // garage
  [24, 22, 9, 22, 'vertical', true, 9568], // garage
  [24, 23, 9, 23, 'vertical', true, 9568], // garage
  [24, 25, 9, 25, 'vertical', true, 9568], // garage
  [24, 30, 9, 30, 'vertical', true, 10765], // garage
  [24, 30, 9, 30, 'vertical', true, 10765], // garage
  [24, 35, 9, 35, 'vertical', true, 11813], // garage
  [24, 40, 9, 40, 'vertical', true, 12842], // garage
  [24, 45, 9, 45, 'vertical', true, 14040], // garage
  [24, 50, 9, 50, 'vertical', true, 14934], // garage
  [24, 55, 9, 55, 'vertical', true, 16401], // garage
  [24, 60, 9, 60, 'vertical', true, 17600], // garage
  [24, 20, 10, 20, 'vertical', true, 9117], // garage
  [24, 25, 10, 25, 'vertical', true, 10048], // garage
  [24, 30, 10, 30, 'vertical', true, 11286], // garage
  [24, 35, 10, 35, 'vertical', true, 12372], // garage
  [24, 40, 10, 40, 'vertical', true, 13504], // garage
  [24, 45, 10, 45, 'vertical', true, 14665], // garage
  [24, 50, 10, 50, 'vertical', true, 15596], // garage
  [24, 55, 10, 55, 'vertical', true, 17102], // garage
  [24, 60, 10, 60, 'vertical', true, 18340], // garage
  [24, 20, 11, 20, 'vertical', true, 9901], // garage
  [24, 25, 11, 25, 'vertical', true, 10890], // garage
  [24, 30, 11, 30, 'vertical', true, 12238], // garage
  [24, 35, 11, 35, 'vertical', true, 13365], // garage
  [24, 40, 11, 40, 'vertical', true, 14543], // garage
  [24, 45, 11, 45, 'vertical', true, 15847], // garage
  [24, 50, 11, 50, 'vertical', true, 16836], // garage
  [24, 55, 11, 55, 'vertical', true, 18454], // garage
  [24, 60, 11, 60, 'vertical', true, 19801], // garage
  [24, 20, 12, 20, 'vertical', true, 10673], // garage
  [24, 25, 12, 25, 'vertical', true, 11680], // garage
  [24, 30, 12, 30, 'vertical', true, 13042], // garage
  [24, 35, 12, 35, 'vertical', true, 14365], // garage
  [24, 40, 12, 40, 'vertical', true, 15633], // garage
  [24, 45, 12, 45, 'vertical', true, 17055], // garage
  [24, 50, 12, 50, 'vertical', true, 18063], // garage
  [24, 55, 12, 55, 'vertical', true, 19694], // garage
  [24, 60, 12, 60, 'vertical', true, 21055], // garage
  [26, 30, 6, 30, 'vertical', true, 11852], // garage
  [26, 30, 7, 30, 'vertical', true, 12235], // garage
  [26, 30, 8, 30, 'vertical', true, 12883], // garage
  [26, 25, 9, 25, 'vertical', true, 11874], // garage
  [26, 30, 9, 30, 'vertical', true, 13312], // garage
  [26, 30, 9, 30, 'vertical', true, 13312], // garage
  [26, 30, 10, 30, 'vertical', true, 13790], // garage
  [26, 30, 11, 30, 'vertical', true, 14701], // garage
  [26, 30, 12, 30, 'vertical', true, 18337], // garage
  [28, 30, 6, 30, 'vertical', true, 12517], // garage
  [28, 30, 7, 30, 'vertical', true, 12994], // garage
  [28, 30, 8, 30, 'vertical', true, 13574], // garage
  [28, 30, 9, 30, 'vertical', true, 14043], // garage
  [28, 30, 9, 30, 'vertical', true, 14043], // garage
  [28, 30, 10, 30, 'vertical', true, 14521], // garage
  [28, 30, 11, 30, 'vertical', true, 15576], // garage
  [28, 30, 12, 30, 'vertical', true, 19172], // garage
  [30, 30, 6, 5, 'vertical', true, 11934], // combo
  [30, 30, 6, 10, 'vertical', true, 12078], // combo
  [30, 30, 6, 15, 'vertical', true, 12208], // combo
  [30, 20, 6, 20, 'vertical', true, 10702], // garage
  [30, 30, 6, 20, 'vertical', true, 12664], // combo
  [30, 25, 6, 25, 'vertical', true, 11809], // garage
  [30, 30, 6, 25, 'vertical', true, 12878], // combo
  [30, 30, 6, 30, 'vertical', true, 13132], // garage
  [30, 35, 6, 35, 'vertical', true, 14390], // garage
  [30, 40, 6, 40, 'vertical', true, 15794], // garage
  [30, 45, 6, 45, 'vertical', true, 16966], // garage
  [30, 50, 6, 50, 'vertical', true, 18073], // garage
  [30, 55, 6, 55, 'vertical', true, 19666], // garage
  [30, 60, 6, 60, 'vertical', true, 20989], // garage
  [30, 30, 7, 5, 'vertical', true, 12449], // combo
  [30, 30, 7, 10, 'vertical', true, 12605], // combo
  [30, 30, 7, 15, 'vertical', true, 12741], // combo
  [30, 20, 7, 20, 'vertical', true, 11076], // garage
  [30, 30, 7, 20, 'vertical', true, 13083], // combo
  [30, 25, 7, 25, 'vertical', true, 12265], // garage
  [30, 30, 7, 25, 'vertical', true, 13353], // combo
  [30, 30, 7, 30, 'vertical', true, 13581], // garage
  [30, 35, 7, 35, 'vertical', true, 14938], // garage
  [30, 40, 7, 40, 'vertical', true, 16356], // garage
  [30, 45, 7, 45, 'vertical', true, 17588], // garage
  [30, 50, 7, 50, 'vertical', true, 18779], // garage
  [30, 55, 7, 55, 'vertical', true, 20363], // garage
  [30, 60, 7, 60, 'vertical', true, 21679], // garage
  [30, 30, 8, 5, 'vertical', true, 12823], // combo
  [30, 30, 8, 10, 'vertical', true, 12979], // combo
  [30, 30, 8, 15, 'vertical', true, 13115], // combo
  [30, 20, 8, 20, 'vertical', true, 11455], // garage
  [30, 30, 8, 20, 'vertical', true, 13509], // combo
  [30, 25, 8, 25, 'vertical', true, 12738], // garage
  [30, 30, 8, 25, 'vertical', true, 13847], // combo
  [30, 30, 8, 30, 'vertical', true, 14163], // garage
  [30, 35, 8, 35, 'vertical', true, 15480], // garage
  [30, 35, 8, 35, 'vertical', true, 15480], // garage
  [30, 40, 8, 40, 'vertical', true, 16952], // garage
  [30, 45, 8, 45, 'vertical', true, 18228], // garage
  [30, 50, 8, 50, 'vertical', true, 19513], // garage
  [30, 55, 8, 55, 'vertical', true, 21208], // garage
  [30, 60, 8, 60, 'vertical', true, 22632], // garage
  [30, 30, 9, 5, 'vertical', true, 13206], // combo
  [30, 30, 9, 10, 'vertical', true, 13362], // combo
  [30, 30, 9, 15, 'vertical', true, 13498], // combo
  [30, 20, 9, 20, 'vertical', true, 11873], // garage
  [30, 30, 9, 20, 'vertical', true, 13984], // combo
  [30, 25, 9, 25, 'vertical', true, 13168], // garage
  [30, 30, 9, 25, 'vertical', true, 14308], // combo
  [30, 30, 9, 30, 'vertical', true, 14606], // garage
  [30, 35, 9, 35, 'vertical', true, 15982], // garage
  [30, 40, 9, 40, 'vertical', true, 17466], // garage
  [30, 45, 9, 45, 'vertical', true, 18868], // garage
  [30, 50, 9, 50, 'vertical', true, 20163], // garage
  [30, 55, 9, 55, 'vertical', true, 21871], // garage
  [30, 60, 9, 60, 'vertical', true, 23311], // garage
  [30, 30, 10, 5, 'vertical', true, 13736], // combo
  [30, 30, 10, 10, 'vertical', true, 13984], // combo
  [30, 30, 10, 15, 'vertical', true, 14278], // combo
  [30, 20, 10, 20, 'vertical', true, 12374], // garage
  [30, 30, 10, 20, 'vertical', true, 14532], // combo
  [30, 25, 10, 25, 'vertical', true, 13793], // garage
  [30, 30, 10, 25, 'vertical', true, 14954], // combo
  [30, 30, 10, 30, 'vertical', true, 15188], // garage
  [30, 35, 10, 35, 'vertical', true, 16615], // garage
  [30, 40, 10, 40, 'vertical', true, 18211], // garage
  [30, 45, 10, 45, 'vertical', true, 19682], // garage
  [30, 50, 10, 50, 'vertical', true, 21101], // garage
  [30, 55, 10, 55, 'vertical', true, 22766], // garage
  [30, 60, 10, 60, 'vertical', true, 24161], // garage
  [30, 30, 11, 5, 'vertical', true, 14375], // combo
  [30, 30, 11, 10, 'vertical', true, 14623], // combo
  [30, 30, 11, 15, 'vertical', true, 14917], // combo
  [30, 20, 11, 20, 'vertical', true, 13190], // garage
  [30, 30, 11, 20, 'vertical', true, 15399], // combo
  [30, 25, 11, 25, 'vertical', true, 14707], // garage
  [30, 30, 11, 25, 'vertical', true, 15893], // combo
  [30, 30, 11, 30, 'vertical', true, 16257], // garage
  [30, 35, 11, 35, 'vertical', true, 17795], // garage
  [30, 40, 11, 40, 'vertical', true, 19542], // garage
  [30, 45, 11, 45, 'vertical', true, 20942], // garage
  [30, 50, 11, 50, 'vertical', true, 22461], // garage
  [30, 55, 11, 55, 'vertical', true, 24281], // garage
  [30, 60, 11, 60, 'vertical', true, 25831], // garage
  [30, 30, 12, 5, 'vertical', true, 17897], // combo
  [30, 30, 12, 10, 'vertical', true, 18145], // combo
  [30, 30, 12, 15, 'vertical', true, 18439], // combo
  [30, 20, 12, 20, 'vertical', true, 16555], // garage
  [30, 30, 12, 20, 'vertical', true, 19039], // combo
  [30, 25, 12, 25, 'vertical', true, 18203], // garage
  [30, 30, 12, 25, 'vertical', true, 19533], // combo
  [30, 30, 12, 30, 'vertical', true, 19851], // garage
  [30, 35, 12, 35, 'vertical', true, 21526], // garage
  [30, 40, 12, 40, 'vertical', true, 23507], // garage
  [30, 45, 12, 45, 'vertical', true, 25142], // garage
  [30, 50, 12, 50, 'vertical', true, 26790], // garage
  [30, 55, 12, 55, 'vertical', true, 28708], // garage
  [30, 60, 12, 60, 'vertical', true, 30358], // garage
];

describe('our quote reproduces the manufacturer, to the dollar', () => {
  for (const [widthFt, lengthFt, legHeightFt, enclosedDepthFt, siding, engineered, vendor] of MEASURED) {
    const what =
      enclosedDepthFt === 0 ? 'carport'
      : enclosedDepthFt >= lengthFt ? 'garage'
      : `combo enclosed ${enclosedDepthFt}ft`;
    it(`${widthFt}x${lengthFt}x${legHeightFt} ${siding} siding${engineered ? '' : ', not certified'}, ${what}`, () => {
      const q = quoteFromTable(
        {
          widthFt,
          lengthFt,
          legHeightFt,
          roofStyle: 'vertical',
          surface: 'concrete',
          engineered,
          siding,
          enclosedDepthFt,
        },
        table,
      );
      expect(q.unpriceable ?? []).toEqual([]);
      expect(q.total).toBe(vendor);
    });
  }
});

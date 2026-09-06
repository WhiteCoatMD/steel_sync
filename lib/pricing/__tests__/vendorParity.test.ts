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
  [12, 30, 9, 30, 'horizontal', true, 5782], // garage
  [14, 30, 9, 30, 'horizontal', true, 6277], // garage
  [16, 30, 9, 30, 'horizontal', true, 6277], // garage
  [18, 30, 9, 30, 'horizontal', true, 6277], // garage
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
  [22, 30, 9, 30, 'horizontal', true, 7530], // garage
  [24, 30, 9, 5, 'horizontal', true, 7421], // combo
  [24, 30, 9, 10, 'horizontal', true, 7577], // combo
  [24, 30, 9, 15, 'horizontal', true, 7713], // combo
  [24, 30, 9, 20, 'horizontal', true, 7819], // combo
  [24, 30, 9, 25, 'horizontal', true, 7923], // combo
  [24, 30, 9, 30, 'horizontal', true, 8027], // garage
  [24, 20, 12, 20, 'horizontal', true, 8015], // garage
  [24, 25, 12, 25, 'horizontal', true, 8836], // garage
  [24, 30, 12, 30, 'horizontal', true, 10010], // garage
  [24, 35, 12, 35, 'horizontal', true, 11145], // garage
  [24, 40, 12, 40, 'horizontal', true, 12225], // garage
  [24, 45, 12, 45, 'horizontal', true, 13393], // garage
  [24, 50, 12, 50, 'horizontal', true, 14215], // garage
  [24, 55, 12, 55, 'horizontal', true, 15388], // garage
  [24, 60, 12, 60, 'horizontal', true, 16561], // garage
  [26, 30, 9, 30, 'horizontal', true, 10290], // garage
  [28, 30, 9, 30, 'horizontal', true, 10889], // garage
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
  [30, 30, 7, 25, 'horizontal', true, 10195], // combo
  [30, 30, 8, 5, 'horizontal', true, 10207], // combo
  [30, 30, 8, 10, 'horizontal', true, 10363], // combo
  [30, 30, 8, 15, 'horizontal', true, 10499], // combo
  [30, 30, 8, 20, 'horizontal', true, 10499], // combo
  [30, 30, 8, 25, 'horizontal', true, 10683], // combo
  [30, 30, 9, 5, 'horizontal', true, 10592], // combo
  [30, 30, 9, 10, 'horizontal', true, 10748], // combo
  [30, 30, 9, 15, 'horizontal', true, 10884], // combo
  [30, 30, 9, 20, 'horizontal', true, 10976], // combo
  [30, 30, 9, 25, 'horizontal', true, 11146], // combo
  [30, 30, 10, 5, 'horizontal', true, 11120], // combo
  [30, 30, 10, 10, 'horizontal', true, 11368], // combo
  [30, 30, 10, 15, 'horizontal', true, 11662], // combo
  [30, 30, 10, 20, 'horizontal', true, 11524], // combo
  [30, 30, 10, 25, 'horizontal', true, 11792], // combo
  [30, 30, 11, 5, 'horizontal', true, 11499], // combo
  [30, 30, 11, 10, 'horizontal', true, 11747], // combo
  [30, 30, 11, 15, 'horizontal', true, 12041], // combo
  [30, 30, 11, 20, 'horizontal', true, 12001], // combo
  [30, 30, 11, 25, 'horizontal', true, 12277], // combo
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
  [12, 30, 9, 30, 'vertical', true, 7972], // garage
  [14, 30, 9, 30, 'vertical', true, 8729], // garage
  [16, 30, 9, 30, 'vertical', true, 8729], // garage
  [18, 30, 9, 30, 'vertical', true, 8729], // garage
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
  [22, 30, 9, 30, 'vertical', true, 10202], // garage
  [24, 60, 6, 60, 'vertical', true, 15808], // garage
  [24, 30, 9, 30, 'vertical', true, 10765], // garage
  [26, 30, 9, 30, 'vertical', true, 13312], // garage
  [28, 30, 9, 30, 'vertical', true, 14043], // garage
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
  [30, 30, 8, 20, 'vertical', true, 13509], // combo
  [30, 30, 8, 25, 'vertical', true, 13847], // combo
  [30, 35, 8, 35, 'vertical', true, 15480], // garage
  [30, 30, 9, 5, 'vertical', true, 13206], // combo
  [30, 30, 9, 10, 'vertical', true, 13362], // combo
  [30, 30, 9, 15, 'vertical', true, 13498], // combo
  [30, 30, 9, 20, 'vertical', true, 13984], // combo
  [30, 30, 9, 25, 'vertical', true, 14308], // combo
  [30, 30, 10, 5, 'vertical', true, 13736], // combo
  [30, 30, 10, 10, 'vertical', true, 13984], // combo
  [30, 30, 10, 15, 'vertical', true, 14278], // combo
  [30, 30, 10, 20, 'vertical', true, 14532], // combo
  [30, 30, 10, 25, 'vertical', true, 14954], // combo
  [30, 30, 11, 5, 'vertical', true, 14375], // combo
  [30, 30, 11, 10, 'vertical', true, 14623], // combo
  [30, 30, 11, 15, 'vertical', true, 14917], // combo
  [30, 30, 11, 20, 'vertical', true, 15399], // combo
  [30, 30, 11, 25, 'vertical', true, 15893], // combo
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

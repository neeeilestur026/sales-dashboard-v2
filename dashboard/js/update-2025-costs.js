/* update-2025-costs.js — write the complete 2025 cost breakdown (SalesOrder_2025.xlsx, embedded
   below) into each 2025 sales order's cost detail via saveSOCostDetails: purchase of goods, bank
   charges, shipment cost, import duties, local charges and delivery-to-client, plus the
   International/Local label. The backend regenerates the SO's migrated invoice/receiving so the
   income statement & summaries reflect the real COGS. Revenue is always kept from the system —
   the file has no selling prices. */

let ucSession = null;
let ucOrders = [];      // file SALES-ORDER groups (keyed by the file's Client PO = our SO No): {poId, soRef, batches[], client, norm, vendor, goods, bank, ship, duties, local, deliv, intl, note, lines[], soNo, matchKind}
let ucStock = [];       // Warehouse groups (inventory, never written to an SO)
let ucSos = [];         // 2025 sales orders (with current sales/cogs resolved)
let ucCds = {};         // full SOCostDetails records by soNo (for the pre-apply backup)
let ucSelected = new Set();
let ucOpen = new Set();          // expanded item-line rows
const UC_BACKUP_KEY = 'uc2025Backup';

// ── Embedded dataset: SalesOrder_2025.xlsx, one entry per PO NUMBER group ────
const UC25_DATA = [{"ord":5,"poId":"180100003867","soRef":"180100003867","client":"Philcement Corporation","clientPO":"180100003867","vendor":"Power Team Hydraulic Technologies","logistics":"Foureleven","date":"2025-08-01","batches":["2025-01"],"goods":528996.61,"bank":893.5,"ship":31593.57,"duties":80752.87,"local":0.0,"deliv":0.0,"intl":true,"wh":false,"note":"PO Date stored as 01-Aug-2025; payment ledger (13-Jan) suggests true date is 08-Jan-2025 (d/m vs m/d entry)","lines":[{"batch":"2025-01","code":"TWHC11","desc":"Torque Wrench, 11134 ftlbs/15095 Nm, Sq Drv, 1-1/2\"","qty":1.0,"cost":8959.0,"cur":"USD"}]},{"ord":6,"poId":"180100003860","soRef":"180100003860","client":"Philcement Corporation","clientPO":"180100003860","vendor":"Power Team Hydraulic Technologies","logistics":"Foureleven","date":"2025-08-01","batches":["2025-01"],"goods":332372.13,"bank":561.39,"ship":19850.45,"duties":50737.57,"local":0.0,"deliv":0.0,"intl":true,"wh":false,"note":"PO Date stored as 01-Aug-2025; payment ledger (13-Jan) suggests true date is 08-Jan-2025 (d/m vs m/d entry)","lines":[{"batch":"2025-01","code":"PE55TWP-4-220-BS","desc":"PUMP, Elec/Hyd - 220/230V, 50/60 hz (4-Ports)","qty":1.0,"cost":5629.0,"cur":"USD"}]},{"ord":7,"poId":"PO7652-FIMI WAREHOUSE-20241007","soRef":"PO7652-FIMI WAREHOUSE-20241007","client":"Freyssinet International MAnila, Inc.","clientPO":"PO7652-FIMI WAREHOUSE-20241007","vendor":"Power Team Hydraulic Technologies","logistics":"Foureleven","date":"2025-08-01","batches":["2025-01"],"goods":9388.37,"bank":15.86,"ship":560.71,"duties":1433.16,"local":0.0,"deliv":0.0,"intl":true,"wh":false,"note":"PO Date stored as 01-Aug-2025; payment ledger (13-Jan) suggests true date is 08-Jan-2025 (d/m vs m/d entry)","lines":[{"batch":"2025-01","code":"21045","desc":"TUBE, OIL LINE","qty":1.0,"cost":87.0,"cur":"USD"},{"batch":"2025-01","code":"21091","desc":"COUPLING","qty":1.0,"cost":24.0,"cur":"USD"},{"batch":"2025-01","code":"10303","desc":"O-RING(-018)0.739IDX0.070NITRILE80","qty":2.0,"cost":12.0,"cur":"USD"},{"batch":"2025-01","code":"10271","desc":"O-RING(-112)0.487IDX0.103NITRILE70","qty":2.0,"cost":12.0,"cur":"USD"},{"batch":"2025-01","code":"10445","desc":"SPRINGCOMOD.166IDX.XXXR.580L.751 MW","qty":4.0,"cost":24.0,"cur":"USD"}]},{"ord":12,"poId":"180100004263","soRef":"180100004263","client":"Philcement Corporation","clientPO":"180100004263","vendor":"Black Iron Italy","logistics":"DHL Global","date":"02/18/2025","batches":["2025-02"],"goods":34491.32,"bank":685.3,"ship":83509.04,"duties":8667.34,"local":0.0,"deliv":0.0,"intl":true,"wh":false,"note":"","lines":[{"batch":"2025-02","code":"SD112-55","desc":"Impact socket Blackiron square drive 1” 1/2 hex 55 mm af – standard","qty":1.0,"cost":72.11,"cur":"USD"},{"batch":"2025-02","code":"SD112-212","desc":"Impact socket Blackiron square drive 1” 1/2 hex 2\"1/2 af – standard","qty":1.0,"cost":96.14,"cur":"USD"},{"batch":"2025-02","code":"SD112-65","desc":"Impact socket Blackiron square drive 1” 1/2 hex 65 mm af – standard","qty":1.0,"cost":95.25,"cur":"USD"},{"batch":"2025-02","code":"SD112-75","desc":"Impact socket Blackiron square drive 1” 1/2 hex 75 mm af","qty":1.0,"cost":132.51,"cur":"USD"},{"batch":"2025-02","code":"SD112-85","desc":"Impact socket Blackiron square drive 1” 1/2 hex 85 mm af – standard","qty":1.0,"cost":168.45,"cur":"USD"}]},{"ord":17,"poId":"2025-03","soRef":"","client":"","clientPO":"","vendor":"JYL Enterprises Inc.","logistics":"","date":"02/24/2026","batches":["2025-03"],"goods":12908.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":470.0,"intl":false,"wh":false,"note":"Recorded total 12,520.76 vs items sum 12,908.00 (diff -387.24) — verify","lines":[{"batch":"2025-03","code":"","desc":"1 DRIVE DEEP IMPACT 33MM","qty":2.0,"cost":5884.0,"cur":"PHP"},{"batch":"2025-03","code":"","desc":"1 DRIVE DEEP IMPACT 41MM","qty":2.0,"cost":7024.0,"cur":"PHP"}]},{"ord":19,"poId":"2320003733","soRef":"2320003733","client":"Panabo Trucking Services, Inc.","clientPO":"2320003733","vendor":"Ken tool Hardware Corporation","logistics":"","date":"2025-04-03","batches":["2025-04","2025-05"],"goods":15201.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":165.0,"intl":false,"wh":false,"note":"Blocks 2025-04+05: one ₱15,201 payment covered both — 04 revalued to cost 11,823 per user decision so the sum is exact.","lines":[{"batch":"2025-04","code":"","desc":"IMPACT DEEP SOCKET 1\" DRIVE # \n21MM SK TOOL","qty":7.0,"cost":11823.0,"cur":"USD"},{"batch":"2025-05","code":"","desc":"IMPACT DEEP SOCKET 1\" DRIVE # \n21MM SK TOOL","qty":2.0,"cost":3378.0,"cur":"PHP"}]},{"ord":21,"poId":"MPI100008684","soRef":"MPI100008684","client":"SMC MALITA POWER INC.","clientPO":"MPI100008684","vendor":"Ken tool Hardware Corporation / Snap-on Tools Singapore PTE LTD","logistics":"","date":"03/29/2025","batches":["2025-06"],"goods":278712.76,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":false,"wh":false,"note":"No internal PO number recorded in source No internal PO number recorded in source; Tagged INTERNATIONAL; amount appears PHP-denominated (no FX conversion recorded) Includes the ₱199,912.76 Snap-on local tool-storage row (file attributes it to this SO) — goods now exceed this SO's recorded revenue.","lines":[{"batch":"2025-06","code":"","desc":"HYDRAULIC PULLER KIT, MAX. STROKE 80 MM (3.1 IN), NOMINAL WORKING FORCE 100 KN, SKF P/N: TMHC 110E","qty":1.0,"cost":78800.0,"cur":"PHP"},{"batch":"(noPO)","code":"","desc":"Tool Storage Set, 334 pcs hand tools, 26\" 7 drawer roll cab","qty":0.0,"cost":199912.76,"cur":"PHP"}]},{"ord":22,"poId":"180100004572","soRef":"180100004572","client":"Philcement Corporation","clientPO":"180100004572","vendor":"Power Team Hydraulic Technologies","logistics":"DHL EXPRESS","date":"04/16/2026","batches":["2025-07"],"goods":78416.29,"bank":0.0,"ship":3053.15,"duties":6544.54,"local":606.75,"deliv":1198.4,"intl":true,"wh":false,"note":"","lines":[{"batch":"2025-07","code":"RLS300","desc":"CYL,30TON,1/2\"STROKE","qty":2.0,"cost":1179.36,"cur":"USD"}]},{"ord":23,"poId":"180100004575","soRef":"180100004575","client":"Philcement Corporation","clientPO":"180100004575","vendor":"Power Team Hydraulic Technologies","logistics":"DHL EXPRESS","date":"04/16/2026","batches":["2025-07"],"goods":75698.16,"bank":0.0,"ship":2947.31,"duties":6317.68,"local":585.71,"deliv":0.0,"intl":true,"wh":false,"note":"","lines":[{"batch":"2025-07","code":"P300","desc":"HAND PUMP, 2-SPD, .160-2.6 CU IN/STROKE","qty":1.0,"cost":725.76,"cur":"USD"},{"batch":"2025-07","code":"9670","desc":"TEE ADPT, 1/4\", 3/8\" NPTF F, 3/8\" NPTF M","qty":1.0,"cost":49.84,"cur":"USD"},{"batch":"2025-07","code":"9051","desc":"GAUGE, 4\", UNIVERSAL, DRY, 10k/200 PSI","qty":1.0,"cost":181.44,"cur":"USD"},{"batch":"2025-07","code":"9077","desc":"GGE 4\" 0-150TON C/R/RD/RLS, DRY 2000 PSI","qty":1.0,"cost":181.44,"cur":"USD"}]},{"ord":27,"poId":"1811000000001","soRef":"1811000000001","client":"Philcement Corporation","clientPO":"1811000000001","vendor":"Power Team Hydraulic Technologies","logistics":"","date":"04/30/2025","batches":["2025-08"],"goods":116271.52,"bank":0.0,"ship":45724.47,"duties":33418.07,"local":4973.69,"deliv":0.0,"intl":true,"wh":false,"note":"","lines":[{"batch":"2025-08","code":"C1006C","desc":"CYL, 100 TON 6-5/8\" STROKE","qty":1.0,"cost":2408.0,"cur":"USD"}]},{"ord":28,"poId":"SMPO-106230","soRef":"SMPO-106230","client":"Semirara Mining & Power Corporation","clientPO":"SMPO-106230","vendor":"Power Team Hydraulic Technologies","logistics":"FOURELEVEN","date":"05/30/2025","batches":["2025-09"],"goods":566737.99,"bank":1396.25,"ship":47538.02,"duties":122263.81,"local":0.0,"deliv":0.0,"intl":true,"wh":false,"note":"","lines":[{"batch":"2025-09","code":"PE604BF1P","desc":"PUMP, ELEC./HYD., 230VAC, 50/60 HZ, AUTO","qty":1.0,"cost":10106.1,"cur":"USD"}]},{"ord":29,"poId":"MPI100009003","soRef":"MPI100009003","client":"SMC MALITA POWER INC.","clientPO":"MPI100009003","vendor":"Power Team Hydraulic Technologies","logistics":"","date":"2026-10-06","batches":["2025-10"],"goods":239778.8,"bank":1133.0,"ship":40404.06,"duties":39827.32,"local":0.0,"deliv":4779.45,"intl":true,"wh":false,"note":"Recorded total 4,210.00 vs items sum 4,188.40 (diff +21.60) — verify; One shipment shared by PO 2025-10 & 2025-12 (1st leg); split by peso value","lines":[{"batch":"2025-10","code":"RH120","desc":"CYL, 12 TON, 5/6\" STROKE SINGLE ACTING S/R CENTER HOLE","qty":1.0,"cost":592.2,"cur":"USD"},{"batch":"2025-10","code":"RH306","desc":"CYL, 30 TON, 6\" STROKE SINGLE ACTING S/R CENTER HOLE","qty":1.0,"cost":1498.0,"cur":"USD"},{"batch":"2025-10","code":"PT116","desc":"PULLER, MANUAL 3JAW 40 TON","qty":1.0,"cost":1064.2,"cur":"USD"},{"batch":"2025-10","code":"P159","desc":"HAND PUMP, 2-SPEED, .160-2.6 CU IN/STROKE","qty":1.0,"cost":608.3,"cur":"USD"},{"batch":"2025-10","code":"9795","desc":"QUICK COUPLER, COMPLETE","qty":1.0,"cost":87.5,"cur":"USD"},{"batch":"2025-10","code":"9670","desc":"TEE ADPT, 1/4\", 3/8\" NPTF F, 3/8\" NPTF M","qty":1.0,"cost":62.3,"cur":"USD"},{"batch":"2025-10","code":"9040","desc":"GAUGE,2.5\"UNIVERSAL,FILLED, 2500/500 PSI","qty":1.0,"cost":123.9,"cur":"USD"},{"batch":"2025-10","code":"9758","desc":"HOSE, RUBBER .25\" INTERNAL DIA, 10'","qty":1.0,"cost":152.0,"cur":"USD"}]},{"ord":37,"poId":"232004139","soRef":"232004139","client":"Panabo Trucking Services Inc","clientPO":"232004139","vendor":"JYL Enterprises Inc.","logistics":"","date":"2026-11-06","batches":["2025-11"],"goods":9834.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":1255.0,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-11","code":"","desc":"MODEL: 3206AM KOKEN BRAND 3/8sd-27pc","qty":1.0,"cost":9834.0,"cur":"PHP"}]},{"ord":38,"poId":"2025-12","soRef":"","client":"WAREHOUSE","clientPO":"","vendor":"Power Team Hydraulic Technologies","logistics":"","date":"06/30/2026","batches":["2025-12"],"goods":136428.64,"bank":975.8,"ship":5381.01,"duties":5304.2,"local":0.0,"deliv":0.0,"intl":true,"wh":true,"note":"One shipment shared by PO 2025-10 & 2025-12 (1st leg); split by peso value 2nd shipment — cost & duties not recorded (₱47,872.35 FOURELEVEN payment 03-Nov is a candidate) One shipment shared by PO 2025-10 & 2025-12 (1st leg); split by peso value 2nd shipment — cost & duties not recorded (₱47,872.35 FOURELEVEN payment 03-Nov is a candidate)","lines":[{"batch":"2025-12","code":"9670","desc":"TEE ADPT, 1/4\", 3/8\" NPTF F, 3/8\" NPTF M","qty":1.0,"cost":65.1,"cur":"USD"},{"batch":"2025-12","code":"9758","desc":"HOSE, RUBBER 25\" INTERNAL DIA, 10","qty":2.0,"cost":320.6,"cur":"USD"},{"batch":"2025-12","code":"9798","desc":"HALF COUPLER, HYD 3/8\" NPTF M","qty":2.0,"cost":86.8,"cur":"USD"},{"batch":"2025-12","code":"9795","desc":"QUICK COUPLER, COMPLETE","qty":1.0,"cost":91.7,"cur":"USD"},{"batch":"2025-12","code":"P300D","desc":"HAND PUMP, 2-SPD, .160-2.6 CU IN/STROKE","qty":1.0,"cost":1339.1,"cur":"USD"},{"batch":"2025-12","code":"9077","desc":"GGE 4\" 0-150TON C/R/RD/RLS, DRY 2000 PSI","qty":1.0,"cost":238.0,"cur":"USD"},{"batch":"2025-12","code":"10431","desc":"FITTING, NUT 5/8-18 F (3/8 OD TUBE)","qty":3.0,"cost":99.9,"cur":"USD"},{"batch":"2025-12","code":"21045","desc":"TUBE, OIL LINE U","qty":1.0,"cost":117.9,"cur":"USD"},{"batch":"2025-12","code":"10430","desc":"TUBE,SLEEVE 3/8 DIA.","qty":3.0,"cost":51.3,"cur":"USD"}]},{"ord":47,"poId":"2320004224","soRef":"2320004224","client":"Panabo Trucking Services, Inc","clientPO":"2320004224","vendor":"Gold Tools Enterprise","logistics":"","date":"2025-07-07","batches":["2025-13"],"goods":14300.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":1243.0,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-13","code":"BB2001","desc":"Harris Welding and Cutting Outfit Complete Set","qty":1.0,"cost":14300.0,"cur":"PHP"}]},{"ord":48,"poId":"SMPO-106212","soRef":"SMPO-106212","client":"Semirara Miing & Power Corporation","clientPO":"SMPO-106212","vendor":"Sun Hydraulic Pte Ltd","logistics":"","date":"2025-04-07","batches":["2025-14"],"goods":9647.5,"bank":596.9,"ship":4507.59,"duties":367.45,"local":0.0,"deliv":0.0,"intl":true,"wh":false,"note":"Tagged LOCAL but has shipment cost, duties & FX recorded — costs shown, NOT allocated per international-only rule Reclassified INTERNATIONAL per user decision (file keeps the source LOCAL tag); ship 4,507.59 + duties 367.45 applied (file shows them unallocated).","lines":[{"batch":"2025-14","code":"RSSM 50","desc":"Single Acting Low Height Flat Cylinders","qty":2.0,"cost":170.0,"cur":"USD"}]},{"ord":49,"poId":"1500004163","soRef":"1500004163","client":"Therma Visayas, Inc.","clientPO":"1500004163","vendor":"7 Tiger Metal Works","logistics":"","date":"07/14/2025","batches":["2025-15"],"goods":22600.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":9227.0,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-15","code":"","desc":"B1 High Tensile G8.8 hex Bolt Full Thread· lOtnm x 25'mm • 1.5P","qty":1600.0,"cost":4800.0,"cur":"PHP"},{"batch":"2025-15","code":"","desc":"BI High tensile G8.8Nut 10 mm 1.5P","qty":1600.0,"cost":2080.0,"cur":"PHP"},{"batch":"2025-15","code":"","desc":"BI ordinary Flat Washer 3/8 (10 mm)","qty":1600.0,"cost":1120.0,"cur":"PHP"},{"batch":"2025-15","code":"","desc":"HDG A325 Heavy duty Hex Bolt 1/2\" x 3-1/2\"","qty":400.0,"cost":10000.0,"cur":"PHP"},{"batch":"2025-15","code":"","desc":"HDG 2H Heavy duty Hex Nut (ASTMA194)","qty":400.0,"cost":2600.0,"cur":"PHP"},{"batch":"2025-15","code":"","desc":"HDGASTM F436 Flat Washer","qty":400.0,"cost":2000.0,"cur":"PHP"}]},{"ord":55,"poId":"PO4500025455","soRef":"PO4500025455","client":"JGC Philippines, Inc.","clientPO":"PO4500025455","vendor":"Toolec, Inc.","logistics":"","date":"07/14/2025","batches":["2025-16"],"goods":229476.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":5337.2,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-16","code":"CUTMASTER 82","desc":"VICTOR THERMAL DYNAMICS (1-1130-1), Air","qty":1.0,"cost":179768.0,"cur":"PHP"},{"batch":"2025-16","code":"","desc":"VICTOR TD 9-8215 ELECTRODE","qty":20.0,"cost":10760.0,"cur":"PHP"},{"batch":"2025-16","code":"","desc":"VICTOR TD 9-8211 TIP","qty":100.0,"cost":37400.0,"cur":"PHP"},{"batch":"2025-16","code":"","desc":"VICTOR TD 9-8218 SHIELD CUP","qty":1.0,"cost":1548.0,"cur":"PHP"}]},{"ord":59,"poId":"PDC1811000000102","soRef":"PDC1811000000102","client":"Petra Cement Inc.","clientPO":"PDC1811000000102","vendor":"Power Team Hydraulic Technologies","logistics":"","date":"07/16/2026","batches":["2025-17"],"goods":0.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":true,"wh":false,"note":"","lines":[{"batch":"2025-17","code":"RSS101","desc":"CYL, 10 TON 1-1/2\" STROKE, S/A S/R SHORTY","qty":1.0,"cost":402.5,"cur":"USD"},{"batch":"2025-17","code":"P59","desc":"HAND PUMP, 2-SPD, .305 CU IN/STROKE","qty":1.0,"cost":415.1,"cur":"USD"},{"batch":"2025-17","code":"9756","desc":"HOSE, RUBBER 25\" INTERNAL DIA, 6'","qty":1.0,"cost":126.0,"cur":"USD"},{"batch":"2025-17","code":"9670","desc":"TEE ADPT, 1/4\", 3/8\" NPTF F, 3/8\" NPTF M","qty":1.0,"cost":65.1,"cur":"USD"},{"batch":"2025-17","code":"9795","desc":"QUICK COUPLER, COMPLETE","qty":1.0,"cost":91.7,"cur":"USD"},{"batch":"2025-17","code":"9798","desc":"HALF COUPLER, HYD, 3/8\" NPTF M","qty":1.0,"cost":43.4,"cur":"USD"},{"batch":"2025-17","code":"9065","desc":"GGE 4\" 0-30TON RH/RLS/RSS, DRY 2000 PSI","qty":1.0,"cost":238.0,"cur":"USD"}]},{"ord":66,"poId":"PDC1811000000275","soRef":"PDC1811000000275","client":"Petra Cement Inc.","clientPO":"PDC1811000000275","vendor":"Ken tool Hardware Corporation","logistics":"","date":"08/16/2025","batches":["2025-19"],"goods":44920.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-19","code":"","desc":"Angel Grinder 9553b 4\"","qty":2.0,"cost":8400.0,"cur":"PHP"},{"batch":"2025-19","code":"","desc":"Impact Wrench Cordless with charger heavy","qty":2.0,"cost":28400.0,"cur":"PHP"},{"batch":"2025-19","code":"","desc":"Bench vise with anvil 8","qty":1.0,"cost":4140.0,"cur":"PHP"},{"batch":"2025-19","code":"","desc":"Feeler Gauge","qty":1.0,"cost":330.0,"cur":"PHP"},{"batch":"2025-19","code":"","desc":"Hand drill 6412 10MM Brand: MAKIT","qty":1.0,"cost":3650.0,"cur":"PHP"}]},{"ord":71,"poId":"EMP1000031","soRef":"EMP1000031","client":"SOUTH LUZON THERMAL","clientPO":"EMP1000031","vendor":"Abasco Tools Trading LLC","logistics":"","date":"08/20/2025","batches":["2025-20"],"goods":0.0,"bank":0.0,"ship":21210.71,"duties":2232.39,"local":2803.99,"deliv":904.0,"intl":true,"wh":false,"note":"Peso amount not recorded — allocation weighted by USD value","lines":[{"batch":"2025-20","code":"","desc":"IMP/DEEP SOCKET 1/2\" DR X 17MM 6 PT #*78L","qty":10.0,"cost":210.0,"cur":"USD"},{"batch":"2025-20","code":"","desc":"IMP/DEEP SOCKET 1/2\" DR X 19MM 6PT #*78L","qty":10.0,"cost":230.0,"cur":"USD"},{"batch":"2025-20","code":"","desc":"IMPACT DEEP SOCKET 1/2\" DR X 30MM *78L","qty":10.0,"cost":294.0,"cur":"USD"}]},{"ord":74,"poId":"2025-20 (freebie)","soRef":"","client":"Freebies","clientPO":"","vendor":"Abasco Tools Trading LLC","logistics":"","date":"08/20/2025","batches":["2025-20"],"goods":0.0,"bank":0.0,"ship":11681.79,"duties":1229.49,"local":1544.29,"deliv":0.0,"intl":true,"wh":false,"note":"Peso amount not recorded — allocation weighted by USD value","lines":[{"batch":"2025-20","code":"KDTW4100T","desc":"TORQUE WRENCH 20-100 NM / 16.6 75.6 FT LB 1/2\" DR","qty":1.0,"cost":404.25,"cur":"USD"}]},{"ord":75,"poId":"2025-21","soRef":"","client":"Warehouse","clientPO":"","vendor":"Power Team Hydraulic Technologies","logistics":"","date":"2025-06-09","batches":["2025-21"],"goods":21928.68,"bank":638.7,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":true,"wh":true,"note":"","lines":[{"batch":"2025-21","code":"9689","desc":"CONNECTOR, 1/4\" NPTF M, 3/8\" NPTF F","qty":5.0,"cost":143.5,"cur":"USD"},{"batch":"2025-21","code":"9796","desc":"KIT, HYD COUPLER 3/8\" NPTF F, W/DUST CAP","qty":1.0,"cost":56.0,"cur":"USD"},{"batch":"2025-21","code":"9795","desc":"QUICK COUPLER, COMPLETE","qty":2.0,"cost":183.4,"cur":"USD"}]},{"ord":78,"poId":"2025-23","soRef":"","client":"Warehouse","clientPO":"","vendor":"Gold Tools Enterprise","logistics":"","date":"09/26/2025","batches":["2025-23"],"goods":45120.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":false,"wh":true,"note":"","lines":[{"batch":"2025-23","code":"BB2001","desc":"Harris Welding and Cutting Outfit Complete Set","qty":3.0,"cost":42900.0,"cur":"PHP"},{"batch":"2025-23","code":"","desc":"Harris 6290-2 Cutting Tip for Acetylene","qty":6.0,"cost":2220.0,"cur":"PHP"}]},{"ord":80,"poId":"SMPO-106788","soRef":"SMPO-106788","client":"Semirara Mining & Power Corporation","clientPO":"SMPO-106788","vendor":"Abasco Tools Trading LLC","logistics":"","date":"2025-11-09","batches":["2025-24"],"goods":103226.68,"bank":882.9,"ship":64813.84,"duties":16310.15,"local":1192.46,"deliv":0.0,"intl":true,"wh":false,"note":"","lines":[{"batch":"2025-24","code":"","desc":"VERNIER CALIPER WITH NIB STYLE JAWS AND FINE ADJUSTMENT 0-1500mm BRAND: DASQUA ITALY","qty":2.0,"cost":6615.0,"cur":"USD"}]},{"ord":81,"poId":"3120012999 | T16","soRef":"3120012999 | T16","client":"Taganito HPAL Nickel Corporation","clientPO":"3120012999 | T16","vendor":"Chicago Pnuematics Tools","logistics":"","date":"2025-12-09","batches":["2025-25"],"goods":1529841.71,"bank":5174.0,"ship":90833.24,"duties":255208.58,"local":0.0,"deliv":0.0,"intl":true,"wh":false,"note":"","lines":[{"batch":"2025-25","code":"6151590380","desc":"IMPACT WRENCH_CP6135-D80 1 1/2\"","qty":4.0,"cost":33930.0,"cur":"USD"}]},{"ord":82,"poId":"2025-26","soRef":"","client":"warehouse","clientPO":"","vendor":"CEJN Products Far East PTE LTD","logistics":"FOURELEVEN","date":"09/15/2026","batches":["2025-26"],"goods":119150.38,"bank":931.1,"ship":47131.38,"duties":38379.35,"local":0.0,"deliv":0.0,"intl":true,"wh":true,"note":"","lines":[{"batch":"2025-26","code":"999999999","desc":"CEJN 720BAR TWIN HOSE, BLACK/YELLOW, DN6, 6M HOSE LENGTH, WITH RUBBER GUARD ON ALL ENDS.","qty":3.0,"cost":945.9,"cur":"USD"},{"batch":"2025-26","code":"999999999","desc":"CEJN 720BAR TWIN HOSE, BLACK/YELLOW, DN6, 3M HOSE LENGTH, WITH RUBBER GUARD ON ALL ENDS","qty":3.0,"cost":662.4,"cur":"USD"},{"batch":"2025-26","code":"999999999","desc":"700BAR HOSE, BLACK, DN6, 6M HOSE LENGTH, END 1: 102311404 AND END 2: 102326434 C/W DUST CAP AND RUBBER GUARD.","qty":5.0,"cost":545.0,"cur":"USD"},{"batch":"2025-26","code":"999999999","desc":"CEJN 720BAR HOSE, RED, DN6, 6M HOSE LENGTH, END 1: 102311404 AND END 2: 102326434 C/W DUST CAP AND RUBBER GUARD.","qty":2.0,"cost":303.4,"cur":"USD"},{"batch":"2025-26","code":"999999999","desc":"CEJN 720BAR HOSE, RED, DN6, 3M HOSE LENGTH,","qty":2.0,"cost":210.4,"cur":"USD"}]},{"ord":87,"poId":"6962","soRef":"6962","client":"Durastress Corporation","clientPO":"6962","vendor":"Power Team Hydraulic Technologies","logistics":"","date":"09/29/2025","batches":["2025-27"],"goods":0.0,"bank":0.0,"ship":5708.17,"duties":25710.62,"local":1192.46,"deliv":0.0,"intl":true,"wh":false,"note":"Peso amount not recorded — allocation weighted by USD value","lines":[{"batch":"2025-27","code":"300625","desc":"KIT, REPAIR SEAL BRAND POWER TEAM","qty":2.0,"cost":464.0,"cur":"USD"},{"batch":"2025-27","code":"58841A","desc":"ARMATURE, 230 VOLT BRAND POWER TEAM","qty":2.0,"cost":1880.0,"cur":"USD"}]},{"ord":89,"poId":"PDC1811000000384","soRef":"PDC1811000000384","client":"Petra Cement Inc.","clientPO":"PDC1811000000384","vendor":"Ken tool Hardware Corporation","logistics":"","date":"09/23/2025","batches":["2025-28"],"goods":24890.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":false,"wh":false,"note":"Recorded total 28,370.00 vs items sum 24,890.00 (diff +3,480.00) — verify","lines":[{"batch":"2025-28","code":"","desc":"TWO JAW PULLER 18\" KWT","qty":1.0,"cost":5500.0,"cur":"PHP"},{"batch":"2025-28","code":"","desc":"THREE JAW PULLER 8\" KWT","qty":1.0,"cost":5500.0,"cur":"PHP"},{"batch":"2025-28","code":"","desc":"Pipe Wrench 14\" STANLEY","qty":1.0,"cost":780.0,"cur":"PHP"},{"batch":"2025-28","code":"","desc":"Pipe Wrench 16\" STANLEY","qty":1.0,"cost":1140.0,"cur":"PHP"},{"batch":"2025-28","code":"","desc":"FEELER GAUGE SKS","qty":1.0,"cost":380.0,"cur":"PHP"},{"batch":"2025-28","code":"","desc":"ADJUSTABLE HOOK SPANNER 6 PCS SK TOOL","qty":1.0,"cost":2850.0,"cur":"PHP"},{"batch":"2025-28","code":"","desc":"VERNIER CALIPER 12\" MITUTOYO","qty":1.0,"cost":5800.0,"cur":"PHP"},{"batch":"2025-28","code":"","desc":"Thread Pitch Gauge, Metric KASTAR","qty":1.0,"cost":980.0,"cur":"PHP"},{"batch":"2025-28","code":"","desc":"Thread Pitch Gauge, Imperial KASTAR","qty":1.0,"cost":980.0,"cur":"PHP"},{"batch":"2025-28","code":"","desc":"Pulley gauge 12 ANGLE 29 TO 90 DEGREE KASTAR","qty":1.0,"cost":980.0,"cur":"PHP"}]},{"ord":99,"poId":"PDC1811000000429","soRef":"PDC1811000000429","client":"Petra Cement Inc.","clientPO":"PDC1811000000429","vendor":"Tools Savvy Marketing Corp.","logistics":"","date":"2025-06-10","batches":["2025-29"],"goods":43260.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-29","code":"","desc":"Makita DTL061Z 18V Cordless Angle Impact Driver (LXT-Series) [Bare]","qty":2.0,"cost":20480.0,"cur":"PHP"},{"batch":"2025-29","code":"","desc":"Makita MKP3PT182 18V LXT Power Source Kit / Battery & Charger Set (5.0Ah)","qty":1.0,"cost":22780.0,"cur":"PHP"}]},{"ord":101,"poId":"PDC1811000000449","soRef":"PDC1811000000449","client":"Petra Cement Inc.","clientPO":"PDC1811000000449","vendor":"Tools Savvy Marketing Corp.","logistics":"","date":"2025-08-10","batches":["2025-30","2025-31"],"goods":28080.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-30","code":"","desc":"Harris BB2001 Cutting & Welding Outfit","qty":1.0,"cost":15680.0,"cur":"PHP"},{"batch":"2025-31","code":"","desc":"Harris 188L/188R Falshback Arrster for Welding & Cutting Outfit","qty":2.0,"cost":12400.0,"cur":"PHP"}]},{"ord":103,"poId":"PDC1811000000459","soRef":"PDC1811000000459","client":"Petra Cement Inc.","clientPO":"PDC1811000000459","vendor":"Tools Savvy Marketing Corp.","logistics":"","date":"10/15/2025","batches":["2025-32"],"goods":33840.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-32","code":"","desc":"Makita DGP180Z Cordless Grease Gun 145 mL/min (5.0 oz/min) 69 MPa (10,000 PSI) 18V LXT® Li-Ion (Bare Tool Only)","qty":2.0,"cost":33840.0,"cur":"PHP"}]},{"ord":104,"poId":"PDC1811000000458","soRef":"PDC1811000000458","client":"Petra Cement Inc.","clientPO":"PDC1811000000458","vendor":"Yale Hardware Corp.","logistics":"","date":"10/15/2025","batches":["2025-33"],"goods":58400.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-33","code":"","desc":"Hans Tools Digital Torque Wrench 4178D2-135 (1/2\"DR ~ 6.8-135Nm)","qty":2.0,"cost":37600.0,"cur":"PHP"},{"batch":"2025-33","code":"","desc":"Hans Tools Digital Torque Wrench 4178D2-340 (1/2\"DR ~ 30-340Nm","qty":1.0,"cost":20800.0,"cur":"PHP"}]},{"ord":106,"poId":"180100005491","soRef":"180100005491","client":"Philcement Corporation","clientPO":"180100005491","vendor":"Toolec, Inc.","logistics":"","date":"10/29/2025","batches":["2025-34"],"goods":298020.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":18154.48,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-34","code":"","desc":"ASTROWELD Model 850C, CC-DC. Thyristor type welding machine. Input voltage:","qty":1.0,"cost":298020.0,"cur":"PHP"}]},{"ord":107,"poId":"150001445","soRef":"150001445","client":"Therma Luzon Inc.","clientPO":"150001445","vendor":"Arc Infinite Good Trading OPC","logistics":"","date":"11/14/2025","batches":["2025-35"],"goods":23520.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":2510.0,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-35","code":"","desc":"Powerhouse TIG 300 Pulse 2in1 (TIG/MMA) DC Inverter Welding Machine","qty":1.0,"cost":23520.0,"cur":"PHP"}]},{"ord":108,"poId":"AQP1007244","soRef":"AQP1007244","client":"South Luzon Thermal Energy Corporation","clientPO":"AQP1007244","vendor":"Xinxiang Jintian Hydraulic Transmission Co., Ltd.","logistics":"DHL","date":"11/15/2025","batches":["2025-36"],"goods":15943.5,"bank":638.5,"ship":5150.39,"duties":4743.37,"local":5629.77,"deliv":0.0,"intl":true,"wh":false,"note":"","lines":[{"batch":"2025-36","code":"","desc":"FUSIBLE PLUG","qty":10.0,"cost":120.0,"cur":"USD"},{"batch":"2025-36","code":"","desc":"EXPLOSIVE PLUG","qty":10.0,"cost":150.0,"cur":"USD"}]},{"ord":110,"poId":"MPI100009558","soRef":"MPI100009558","client":"Malita Power Inc.","clientPO":"MPI100009558","vendor":"Henan Bowey Machinery Equipment Co., Ltd.","logistics":"","date":"11/20/2025","batches":["2025-37"],"goods":11204.0,"bank":0.0,"ship":4475.84,"duties":0.0,"local":3169.19,"deliv":0.0,"intl":true,"wh":false,"note":"Import duties not recorded","lines":[{"batch":"2025-37","code":"","desc":"P. FILTER ELEMENT, DU 40.31044.25G, ELEMENT NO. 312624, FOR IDF HYDRAULIC COUPLING","qty":10.0,"cost":190.0,"cur":"USD"}]},{"ord":111,"poId":"4500025873","soRef":"4500025873","client":"JGC Philippines, Inc.","clientPO":"4500025873","vendor":"Chicago Pneumatics Tools","logistics":"DHL","date":"11/22/2025","batches":["2025-38"],"goods":218264.96,"bank":1246.2,"ship":46539.01,"duties":39381.29,"local":1469.22,"deliv":0.0,"intl":true,"wh":false,"note":"","lines":[{"batch":"2025-38","code":"6151590080","desc":"CP6920-D24 1\" DUAL IMPACT WRENCH","qty":1.0,"cost":1141.25,"cur":"USD"},{"batch":"2025-38","code":"6151590390","desc":"CP6930-D35 1-1/2\" IMPACT WRENCH","qty":1.0,"cost":3672.59,"cur":"USD"}]},{"ord":113,"poId":"MVS-PO100003122","soRef":"MVS-PO100003122","client":"Mariveles Power Generation Corporation","clientPO":"MVS-PO100003122","vendor":"Trimatt Hardware Tools","logistics":"","date":"11/26/2025","batches":["2025-39"],"goods":11600.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-39","code":"","desc":"PIPE WRENCH, 12\" HEAVY DUTY STRAIGHT, RIDGID P/N: 31015","qty":4.0,"cost":11600.0,"cur":"PHP"}]},{"ord":114,"poId":"4500025884","soRef":"4500025884","client":"JGC Philippines, Inc.","clientPO":"4500025884","vendor":"Radical Torque Solutions Pty Ltd","logistics":"","date":"11/27/2025","batches":["2025-40"],"goods":847072.19,"bank":3129.1,"ship":53082.66,"duties":141725.88,"local":1326.86,"deliv":0.0,"intl":true,"wh":false,"note":"","lines":[{"batch":"2025-40","code":"22238","desc":"RAD 30DX TOOL KIT 1.0\"SD 900 - 3,000 LBF.FT inc Reaction Arm, Ret Ring, FRL, Tool Holder, Cal Cert, Manual","qty":1.0,"cost":6396.5,"cur":"USD"},{"batch":"2025-40","code":"15328","desc":"RAD 60DX TOOL KIT 1.5\"SD 2000 - 6,000 LBF.FT inc Reaction Arm, Ret Ring, FRL, Tool Holder, Cal Cert, Manual","qty":1.0,"cost":8021.75,"cur":"USD"}]},{"ord":116,"poId":"OSH-25-035","soRef":"OSH-25-035","client":"Asian Aerospace Corporation","clientPO":"OSH-25-035","vendor":"Aolai Rescue Technology Co.,Ltd","logistics":"FOURELEVEN","date":"11/27/2025","batches":["2025-41","2025-45"],"goods":707160.0,"bank":3299.3,"ship":331324.07,"duties":136761.53,"local":31991.95,"deliv":0.0,"intl":true,"wh":false,"note":"","lines":[{"batch":"2025-41","code":"AL970","desc":"Hand-held petrol circular saw","qty":8.0,"cost":8000.0,"cur":"USD"},{"batch":"2025-45","code":"","desc":"Hand-held petrol circular saw","qty":8.0,"cost":8000.0,"cur":"USD"}]},{"ord":117,"poId":"PDC1811000000648","soRef":"PDC1811000000648","client":"Petra Cement Inc.","clientPO":"PDC1811000000648","vendor":"Tools Savvy Marketing Corp. / Giga Tools","logistics":"","date":"2025-01-12","batches":["2025-42","2025-43"],"goods":25219.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":false,"wh":false,"note":"Block 2025-43 assigned per user decision (file leaves it blank).","lines":[{"batch":"2025-42","code":"DGP180Z","desc":"Makita 18V Cordless Grease Gun (LXT-Series) Bare","qty":1.0,"cost":16920.0,"cur":"PHP"},{"batch":"2025-43","code":"","desc":"Makita (BL1860B + DC18RC) 6.0 Ah 18V LXT Battery And Rapid Charger Bundle","qty":1.0,"cost":8299.0,"cur":"PHP"}]},{"ord":119,"poId":"2320004664","soRef":"2320004664","client":"Panabo Trucking Services, Inc.","clientPO":"2320004664","vendor":"Tools Savvy Marketing Corp.","logistics":"","date":"2025-05-12","batches":["2025-44"],"goods":5600.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-44","code":"","desc":"HARRIS 6290 CUTTING TIP FOR WELDING & CUTTING OUTFIT ACE/ OXY TORCH NOZZLE: #12","qty":10.0,"cost":5600.0,"cur":"PHP"}]},{"ord":121,"poId":"PDC1811000000676","soRef":"PDC1811000000676","client":"Petra Cement Inc.","clientPO":"PDC1811000000676","vendor":"Yale Hardware Corp.","logistics":"","date":"2025-12-12","batches":["2025-46"],"goods":13860.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-46","code":"","desc":"Striking straight box wrench, 12 point ring, 36 mm","qty":1.0,"cost":1200.0,"cur":"PHP"},{"batch":"2025-46","code":"","desc":"Striking straight box wrench, 12 point ring, 41 mm","qty":1.0,"cost":1430.0,"cur":"PHP"},{"batch":"2025-46","code":"","desc":"Striking straight box wrench, 12 point ring, 46 mm","qty":1.0,"cost":1890.0,"cur":"PHP"},{"batch":"2025-46","code":"","desc":"Striking straight box wrench, 12 point ring, 32 mm","qty":1.0,"cost":950.0,"cur":"PHP"},{"batch":"2025-46","code":"","desc":"Striking straight box wrench, 12 point ring, 55 mm","qty":1.0,"cost":3200.0,"cur":"PHP"},{"batch":"2025-46","code":"","desc":"Striking straight box wrench, 12 point ring, 30 mm","qty":1.0,"cost":950.0,"cur":"PHP"},{"batch":"2025-46","code":"","desc":"Striking straight box wrench, 12 point ring, 60 mm","qty":1.0,"cost":4240.0,"cur":"PHP"}]},{"ord":128,"poId":"PDC1811000000698","soRef":"PDC1811000000698","client":"Petra Cement Inc.","clientPO":"PDC1811000000698","vendor":"Ken tool Hardware Corporation","logistics":"","date":"12/16/2025","batches":["2025-48"],"goods":98120.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-48","code":"","desc":"TOKU TCP20 PNEUMATIC JACK HAMMER 23 LBS ACCESSORIES INCLUDED: FEMALE COUPLING MOIL POINT","qty":1.0,"cost":47520.0,"cur":"PHP"},{"batch":"2025-48","code":"","desc":"TOKU AA03 PNEUMATIC JACK HAMMER 4.4 LBS ACCESSORIES INCLUDED: FEMALE COUPLING MOIL POINT","qty":2.0,"cost":50600.0,"cur":"PHP"}]},{"ord":130,"poId":"180100005691","soRef":"180100005691","client":"Philcement Corporation","clientPO":"180100005691","vendor":"Snap-on Tools Singapore PTE LTD","logistics":"FEDEX","date":"12/18/2025","batches":["2025-49"],"goods":104076.0,"bank":900.6,"ship":0.0,"duties":16397.0,"local":0.0,"deliv":0.0,"intl":true,"wh":false,"note":"Recorded total 1,170.00 vs items sum 1,770.00 (diff -600.00) — verify; Shipment cost not recorded (₱48,979.38 FOURELEVEN payment 19-Nov is a candidate)","lines":[{"batch":"2025-49","code":"CT9080K2","desc":"Snap-on, 18 V 1/2\" Drive Monster Lithium Cordless Impact Wrench Kit (Red)","qty":2.0,"cost":1770.0,"cur":"USD"}]},{"ord":131,"poId":"150001628","soRef":"150001628","client":"Therma Luzon Inc.","clientPO":"150001628","vendor":"Arc Infinite Good Trading OPC","logistics":"","date":"12/18/2025","batches":["2025-50"],"goods":34000.0,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":2514.0,"intl":false,"wh":false,"note":"","lines":[{"batch":"2025-50","code":"TIG 300 striker","desc":"POWERHOUSE AC-DC TIG MMA 2IN1 300A INVERTER HEAVY DUTY WELDING MACHINE","qty":1.0,"cost":34000.0,"cur":"PHP"}]},{"ord":132,"poId":"180100003851","soRef":"180100003851","client":"Philcement Corporation","clientPO":"180100003851","vendor":"Snap-on Tools Singapore PTE LTD","logistics":"","date":"","batches":[],"goods":116069.2,"bank":0.0,"ship":0.0,"duties":0.0,"local":0.0,"deliv":0.0,"intl":true,"wh":false,"note":"No internal PO number recorded in source; Tagged INTERNATIONAL; amount appears PHP-denominated (no FX conversion recorded) 2024 Philcement SO — idempotent re-apply of the same ₱116,069.20.","lines":[{"batch":"(noPO)","code":"3000001752","desc":"Tool Storage Set, 334 pcs hand tools, 26\" 7 drawer roll cab","qty":1.0,"cost":116069.2,"cur":"PHP"}]}];

document.addEventListener('DOMContentLoaded', () => {
  ucSession = requireAccountingOrAdmin();
  if (!ucSession) return;
  renderNavbar('update-2025-costs');
  document.getElementById('loadBtn').addEventListener('click', loadAll);
  document.getElementById('selAllBtn').addEventListener('click', () => {
    ucOrders.forEach((o, i) => { if (o.soNo) ucSelected.add(i); });
    render();
  });
  document.getElementById('applySelBtn').addEventListener('click', () => apply([...ucSelected]));
  document.getElementById('applyAllBtn').addEventListener('click', () => apply(ucOrders.map((o, i) => o.soNo ? i : -1).filter(i => i >= 0)));
  document.getElementById('revertBtn').addEventListener('click', revertLast);
  document.getElementById('restoreFileBtn').addEventListener('click', () => document.getElementById('restoreFile').click());
  document.getElementById('restoreFile').addEventListener('change', restoreFromFile);
  _updateBackupStatus();
});

function _msg(t, ok) { const el = document.getElementById('msg'); el.textContent = t; el.style.color = ok ? '#15803d' : '#dc2626'; }
function _n(x) { const v = parseFloat(String(x == null ? '' : x).replace(/,/g, '')); return isFinite(v) ? v : 0; }
function _norm(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(incorporated|corporation|corp|inc|company|co|ltd|opc|the|services|service)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function _yr(d) { const s = flowDate(d); return /^\d{4}/.test(s) ? s.slice(0, 4) : ''; }   // Manila-safe (raw regex mis-read boundary dates)

// ── Load flow data, prepare groups + auto-match ───────────────────────────────
async function loadAll() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="dr-empty">Loading flow data…</div>';
  _msg('', true);
  try {
    const [soRes, cdRes, invRes] = await Promise.all([
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),
      fetchFlow('getSOCostDetails').catch(() => ({ data: [] })),
      fetchFlow('getInvoices').catch(() => ({ data: [] })),
    ]);
    buildOrders();
    buildSos((soRes && soRes.data) || [], (cdRes && cdRes.data) || [], (invRes && invRes.data) || []);
    autoMatch();
    ucSelected = new Set();
    ucOpen = new Set();
    render();
  } catch (e) { c.innerHTML = `<div class="dr-empty" style="color:#dc2626;">${flowEsc(e.message)}</div>`; }
}

function buildOrders() {
  const all = UC25_DATA.map(g => Object.assign({}, g, { norm: _norm(g.client), soNo: '', matchKind: '' }));
  ucStock = all.filter(o => o.wh);
  ucOrders = all.filter(o => !o.wh).sort((a, b) => a.ord - b.ord);
}

// 2025 SOs with their current (system) sales + COGS resolved.
function buildSos(sos, cds, invs) {
  const cdBySo = {}; cds.forEach(cd => { cdBySo[String(cd.soNo)] = cd; });
  ucCds = cdBySo;   // keep the full records for the pre-apply backup
  const invBySo = {}; invs.forEach(v => { const k = String(v.soNo || ''); if (!k) return; invBySo[k] = (invBySo[k] || 0) + _n(v.totalSales); });
  ucSos = sos.filter(s => _yr(s.date) === '2025').map(s => {
    const k = String(s.soNo), cd = cdBySo[k];
    return {
      soNo: k, customer: String(s.customer || '').trim(), norm: _norm(s.customer), date: s.date,
      cogs: cd ? _n(cd.totalCOGS) : 0,
      sales: cd && _n(cd.sales) > 0 ? _n(cd.sales) : (invBySo[k] || _n(s.total)),
      hasCd: !!cd,
    };
  }).sort((a, b) => String(flowDate(a.date)).localeCompare(String(flowDate(b.date))));
}

// Match each file group to its system SO by the Client PO number (the SO No in our system):
// exact first, then digit-tolerant fuzzy (missing prefix like PDC, one-digit typo), then a
// unique-client fallback. Never date-order name guessing — that mis-assigned SOs before.
function _soKey(v) { return String(v || '').toUpperCase().replace(/\s+/g, ''); }
function _digits(v) { return String(v || '').replace(/\D/g, ''); }
function _oneEditDigits(a, b) {   // b formed from a by inserting or deleting exactly ONE digit
  if (Math.abs(a.length - b.length) !== 1) return false;
  const [sh, ln] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < ln.length; i++) if (sh === ln.slice(0, i) + ln.slice(i + 1)) return true;
  return false;
}
function autoMatch() {
  const byKey = {};
  ucSos.forEach(s => { byKey[_soKey(s.soNo)] = s; });
  const byNorm = {};
  ucSos.forEach(s => { (byNorm[s.norm] = byNorm[s.norm] || []).push(s); });
  ucOrders.forEach(o => {
    o.soNo = ''; o.matchKind = '';
    const ref = _soKey(o.soRef);
    if (ref && byKey[ref]) { o.soNo = byKey[ref].soNo; o.matchKind = 'exact'; return; }
    if (ref) {
      const rd = _digits(ref);
      let hit = null;
      if (rd.length >= 7) {
        hit = ucSos.find(s => { const sd = _digits(s.soNo); return sd.length >= 7 && (sd === rd || sd.endsWith(rd) || rd.endsWith(sd)); })
           || ucSos.find(s => _oneEditDigits(rd, _digits(s.soNo)));
      }
      if (hit) { o.soNo = hit.soNo; o.matchKind = 'fuzzy'; return; }
    }
    // unique-client fallback: the client has exactly ONE 2025 SO (e.g. a warehouse-transfer ref)
    if (o.norm) {
      let list = byNorm[o.norm];
      if (!list) {
        const keys = Object.keys(byNorm).filter(k => k && (k.includes(o.norm) || o.norm.includes(k)));
        list = keys.length === 1 ? byNorm[keys[0]] : null;
      }
      if (list && list.length === 1) { o.soNo = list[0].soNo; o.matchKind = 'client'; }
    }
  });
}

function soByNo(no) { return ucSos.find(s => s.soNo === String(no)); }
function orderActual(o) { return o.goods + o.bank + o.ship + o.duties + o.local + o.deliv; }

function render() {
  const c = document.getElementById('container');
  if (!ucOrders.length) { c.innerHTML = '<div class="dr-empty">No 2025 purchase groups in the embedded file.</div>'; return; }
  const actualTot = ucOrders.reduce((s, o) => s + orderActual(o), 0);
  const sysTot = ucSos.reduce((s, x) => s + x.cogs, 0);
  const matched = ucOrders.filter(o => o.soNo).length;
  document.getElementById('kOrders').textContent = ucOrders.length + (ucStock.length ? ` (+${ucStock.length} stock)` : '');
  document.getElementById('kActual').textContent = flowMoney(actualTot, 'PHP');
  document.getElementById('kSystem').textContent = flowMoney(sysTot, 'PHP');
  document.getElementById('kGap').textContent = flowMoney(actualTot - sysTot, 'PHP');
  document.getElementById('kMatch').textContent = `${matched} / ${ucOrders.length - matched}`;

  const sumBySo = {};
  ucOrders.forEach(o => { if (o.soNo) sumBySo[o.soNo] = (sumBySo[o.soNo] || 0) + orderActual(o); });

  const opts = o => {
    const own = ucSos.filter(s => s.norm && (s.norm === o.norm || s.norm.includes(o.norm) || o.norm.includes(s.norm)));
    const rest = ucSos.filter(s => !own.includes(s));
    const opt = s => `<option value="${flowEsc(s.soNo)}"${s.soNo === o.soNo ? ' selected' : ''}>${flowEsc(s.soNo)} — ${flowEsc(s.customer)}</option>`;
    return `<option value="">— unassigned —</option>` +
      (own.length ? `<optgroup label="Same client">${own.map(opt).join('')}</optgroup>` : '') +
      `<optgroup label="All 2025 SOs">${rest.map(opt).join('')}</optgroup>`;
  };

  c.innerHTML = `<table class="mig-table"><thead><tr>
    <th></th><th>PO</th><th>Client (file)</th>
    <th class="num">Goods</th><th class="num">Bank</th><th class="num">Ship</th><th class="num">Duties</th><th class="num">Local</th><th class="num">Deliv</th>
    <th class="num">Actual COGS</th><th>Type</th><th>Sales Order</th><th class="num">System COGS</th><th class="num">Gap</th>
  </tr></thead><tbody>${ucOrders.map((o, i) => {
    const so = o.soNo ? soByNo(o.soNo) : null;
    const sysC = so ? so.cogs : 0;
    const assignedSum = o.soNo ? sumBySo[o.soNo] : 0;
    const gap = so ? assignedSum - sysC : 0;
    const gapCls = !so ? '' : Math.abs(gap) < 1 ? 'gap-ok' : (gap > 0 ? 'gap-pos' : 'gap-neg');
    const main = `<tr>
      <td><input type="checkbox" data-i="${i}" ${ucSelected.has(i) ? 'checked' : ''} ${o.soNo ? '' : 'disabled'}></td>
      <td><strong>${flowEsc(o.poId)}</strong>${o.note ? ` <span title="${flowEsc(o.note)}" style="cursor:help;">⚠️</span>` : ''}
        <div style="font-size:0.64rem;color:var(--text-muted);">${flowEsc((o.batches || []).join(' · '))}${o.vendor ? ' — ' + flowEsc(o.vendor) : ''}</div>
        <button type="button" class="link-btn" data-l="${i}">${ucOpen.has(i) ? '▾ hide' : '▸'} ${o.lines.length} item(s)</button></td>
      <td>${flowEsc(o.client) || '<span class="mig-badge pend">blank client</span>'}</td>
      <td class="num">${flowMoney(o.goods, 'PHP')}</td>
      <td class="num">${o.bank ? flowMoney(o.bank, 'PHP') : '—'}</td>
      <td class="num">${o.ship ? flowMoney(o.ship, 'PHP') : '—'}</td>
      <td class="num">${o.duties ? flowMoney(o.duties, 'PHP') : '—'}</td>
      <td class="num">${o.local ? flowMoney(o.local, 'PHP') : '—'}</td>
      <td class="num">${o.deliv ? flowMoney(o.deliv, 'PHP') : '—'}</td>
      <td class="num" style="font-weight:700;">${flowMoney(orderActual(o), 'PHP')}</td>
      <td><span class="mig-badge ${o.intl ? 'intl' : 'local'}">${o.intl ? 'Intl' : 'Local'}</span></td>
      <td><select data-so="${i}">${opts(o)}</select>${o.matchKind === 'fuzzy' || o.matchKind === 'client' ? `<div style="font-size:0.62rem;color:#b45309;">≈ auto-matched from file ref “${flowEsc(o.soRef || o.client)}” — verify</div>` : ''}</td>
      <td class="num">${so ? flowMoney(sysC, 'PHP') : '—'}</td>
      <td class="num ${gapCls}">${so ? (Math.abs(gap) < 1 ? '✓' : flowMoney(gap, 'PHP')) : '—'}</td>
    </tr>`;
    const detail = ucOpen.has(i) ? `<tr class="uc-lines"><td></td><td colspan="13">
      ${o.note ? `<div style="padding:0.3rem 0.5rem;font-size:0.72rem;color:#b45309;">⚠️ ${flowEsc(o.note)}</div>` : ''}
      <table><thead><tr><th>Batch</th><th>Item Code</th><th>Description</th><th class="num">Qty</th><th class="num">Line Total (${o.intl ? 'foreign currency' : 'PHP'})</th></tr></thead><tbody>
      ${o.lines.map(l => `<tr><td>${flowEsc(l.batch || '—')}</td><td>${flowEsc(l.code)}</td><td>${flowEsc(l.desc)}</td><td class="num">${l.qty}</td><td class="num">${l.cost ? flowNum(l.cost).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}</td></tr>`).join('')}
      </tbody></table></td></tr>` : '';
    return main + detail;
  }).join('')}</tbody></table>`;

  c.querySelectorAll('input[type="checkbox"][data-i]').forEach(cb => cb.addEventListener('change', () => {
    const i = +cb.dataset.i; if (cb.checked) ucSelected.add(i); else ucSelected.delete(i);
  }));
  c.querySelectorAll('select[data-so]').forEach(sel => sel.addEventListener('change', () => {
    const i = +sel.dataset.so; ucOrders[i].soNo = sel.value; if (!sel.value) ucSelected.delete(i); render();
  }));
  c.querySelectorAll('button[data-l]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.l; if (ucOpen.has(i)) ucOpen.delete(i); else ucOpen.add(i); render();
  }));
  renderExtra();
}

// System 2025 SOs with no purchase backing in the file + warehouse stock note.
function renderExtra() {
  const assigned = new Set(ucOrders.map(o => o.soNo).filter(Boolean));
  const orphans = ucSos.filter(s => !assigned.has(s.soNo));
  let html = '';
  if (orphans.length) {
    html += `<div class="sect-title">System 2025 sales orders with NO purchase group in the file — verify their cost manually</div>
      <table class="mig-table"><thead><tr><th>SO</th><th>Customer</th><th class="num">Sales</th><th class="num">System COGS</th><th></th></tr></thead><tbody>` +
      orphans.map(s => `<tr><td><strong>${flowEsc(s.soNo)}</strong></td><td>${flowEsc(s.customer)}</td>
        <td class="num">${flowMoney(s.sales, 'PHP')}</td><td class="num">${flowMoney(s.cogs, 'PHP')}</td>
        <td>${s.hasCd ? '<span class="mig-badge done">has cost detail</span>' : '<span class="mig-badge pend">no cost</span>'}</td></tr>`).join('') +
      `</tbody></table>`;
  }
  if (ucStock.length) {
    const t = ucStock.reduce((s, o) => s + orderActual(o), 0);
    html += `<p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.8rem;">
      ${ucStock.length} Warehouse stock purchase(s) totalling ${flowMoney(t, 'PHP')} are inventory — not written to any sales order.</p>`;
  }
  document.getElementById('extra').innerHTML = html;
}

// ── Apply: sum the selected groups per SO and write the FULL cost breakdown ───
async function apply(idxs) {
  const orders = idxs.map(i => ucOrders[i]).filter(o => o && o.soNo);
  if (!orders.length) { _msg('Nothing selected (assign a Sales Order first).', false); return; }
  const bySo = {};
  orders.forEach(o => {
    const b = bySo[o.soNo] = bySo[o.soNo] || { goods: 0, bank: 0, ship: 0, duties: 0, local: 0, deliv: 0, intl: false, logistics: '' };
    b.goods += o.goods; b.bank += o.bank; b.ship += o.ship; b.duties += o.duties;
    b.local += o.local; b.deliv += o.deliv;
    if (o.intl) b.intl = true;
    if (o.logistics) b.logistics = o.logistics;
  });
  const soNos = Object.keys(bySo);
  if (!confirm(`Write the 2025 cost breakdown into ${soNos.length} sales order(s)? This replaces their current COGS with the file figures (revenue is kept). A backup of the current values is saved first, so you can revert.`)) return;
  _saveBackup(soNos);
  const r2 = v => Math.round(v * 100) / 100;
  const records = soNos.map(soNo => {
    const so = soByNo(soNo), b = bySo[soNo];
    return {
      soNo, customer: so.customer, date: flowDate(so.date), sales: so.sales,
      cogsType: b.intl ? 'international' : 'local',
      purchaseOfGoods: r2(b.goods),
      bankChargeCOGS: r2(b.bank),
      dutiesAndTaxes: r2(b.duties),
      shippingCost: r2(b.ship),
      localCharges: r2(b.local),
      deliveryToClient: r2(b.deliv),
      deliveryToOffice: 0, bankChargeShipping: 0,
      shippingCompany: b.logistics || '',
    };
  });
  await _writeRecords(records, 'Applied 2025 costs to');
}

// Sequentially write cost-detail records (used by both Apply and Revert), then refresh the system side.
async function _writeRecords(records, verb) {
  const prog = document.getElementById('prog'), bar = document.getElementById('progBar');
  prog.style.display = 'block';
  let done = 0; const errs = [];
  for (const rec of records) {
    try {
      const res = await postFlow('saveSOCostDetails', { record: JSON.stringify(rec) });
      if (!res.success) throw new Error(res.message);
    } catch (e) { errs.push(rec.soNo + ': ' + e.message); }
    done++; bar.style.width = Math.round(done / records.length * 100) + '%';
  }
  prog.style.display = 'none'; bar.style.width = '0';
  _msg(errs.length ? `${verb} ${records.length - errs.length}/${records.length} — errors: ${errs.join('; ')}` : `${verb} ${records.length} sales order(s).`, !errs.length);
  try {
    const [soRes, cdRes, invRes] = await Promise.all([
      fetchFlow('getSalesOrders'), fetchFlow('getSOCostDetails'), fetchFlow('getInvoices'),
    ]);
    const keep = ucOrders.map(o => ({ poId: o.poId, soNo: o.soNo }));
    buildSos((soRes && soRes.data) || [], (cdRes && cdRes.data) || [], (invRes && invRes.data) || []);
    keep.forEach(k => { const o = ucOrders.find(x => x.poId === k.poId); if (o) o.soNo = k.soNo; });
    ucSelected = new Set();
    render();
  } catch (e) { /* leave as-is */ }
}

// ── Backup & revert (same durable pattern as the 2026 reconcile tool) ─────────
function _saveBackup(soNos) {
  const records = soNos.map(soNo => {
    const cd = ucCds[String(soNo)];
    if (!cd) {
      const so = soByNo(soNo) || {};
      return { existed: false, soNo: String(soNo), customer: so.customer || '', date: flowDate(so.date) || '', sales: so.sales || 0 };
    }
    return {
      existed: true, soNo: String(cd.soNo), customer: cd.customer || '', date: flowDate(cd.date) || '',
      sales: _n(cd.sales), cogsType: cd.cogsType || 'local',
      purchaseOfGoods: _n(cd.purchaseOfGoods), bankChargeCOGS: _n(cd.bankChargeCOGS),
      dutiesAndTaxes: _n(cd.dutiesAndTaxes), bankChargeShipping: _n(cd.bankChargeShipping),
      shippingCompany: cd.shippingCompany || '', shippingCost: _n(cd.shippingCost),
      localCharges: _n(cd.localCharges), deliveryToOffice: _n(cd.deliveryToOffice),
      deliveryToClient: _n(cd.deliveryToClient), source: cd.source || '',
    };
  });
  const backup = { takenAt: new Date().toISOString(), by: (ucSession && ucSession.name) || '', records };
  try { localStorage.setItem(UC_BACKUP_KEY, JSON.stringify(backup)); } catch (e) { /* still downloads */ }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'update-2025-backup-' + backup.takenAt.replace(/[:.]/g, '-') + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  _updateBackupStatus();
}

function _readLocalBackup() {
  try { return JSON.parse(localStorage.getItem(UC_BACKUP_KEY) || 'null'); } catch (e) { return null; }
}

function _updateBackupStatus() {
  const el = document.getElementById('backupStatus');
  if (!el) return;
  const b = _readLocalBackup();
  el.textContent = b ? `Backup: ${b.records.length} SO(s) · ${new Date(b.takenAt).toLocaleString()}` : 'No backup yet.';
}

async function _restoreBackup(backup, label) {
  const recs = (backup && backup.records) || [];
  if (!recs.length) { _msg('Backup has no records.', false); return; }
  if (!confirm(`Revert ${recs.length} sales order(s) to the values captured ${new Date(backup.takenAt).toLocaleString()}? The income statement returns to those figures.`)) return;
  const records = recs.map(r => Object.assign({
    cogsType: 'local', purchaseOfGoods: 0, bankChargeCOGS: 0, dutiesAndTaxes: 0, bankChargeShipping: 0,
    shippingCompany: '', shippingCost: 0, localCharges: 0, deliveryToOffice: 0, deliveryToClient: 0,
  }, r));
  await _writeRecords(records, label);
}

function revertLast() {
  const b = _readLocalBackup();
  if (!b) { _msg('No backup in this browser — use “Restore from file…” with a downloaded backup.', false); return; }
  return _restoreBackup(b, 'Reverted');
}

function restoreFromFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const b = JSON.parse(rd.result);
      if (!b || !Array.isArray(b.records)) throw new Error('Not an update-2025 backup file.');
      _restoreBackup(b, 'Restored');
    } catch (e) { _msg('Invalid backup file: ' + e.message, false); }
  };
  rd.readAsText(file);
}

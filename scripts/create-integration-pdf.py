"""Render the short frontend handoff. Full reference: docs/integration.md."""
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Preformatted
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT

OUT=Path(__file__).resolve().parents[1]/'output/pdf/ibpm-campus-integration.pdf'
OUT.parent.mkdir(parents=True,exist_ok=True)
navy=colors.HexColor('#13294b'); orange=colors.HexColor('#dd4828'); gray=colors.HexColor('#516175')
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleIBPM',fontName='Helvetica-Bold',fontSize=24,leading=29,textColor=navy,spaceAfter=16))
styles.add(ParagraphStyle(name='SectionIBPM',fontName='Helvetica-Bold',fontSize=13,leading=17,textColor=navy,spaceBefore=12,spaceAfter=7))
styles.add(ParagraphStyle(name='BodyIBPM',fontName='Helvetica',fontSize=10.2,leading=14.2,textColor=navy,spaceAfter=8))
styles.add(ParagraphStyle(name='SmallIBPM',parent=styles['BodyIBPM'],fontSize=8.8,leading=12,textColor=gray))
styles.add(ParagraphStyle(name='CodeIBPM',fontName='Courier',fontSize=8.1,leading=10.7,textColor=navy,backColor=colors.HexColor('#f1f4f8'),borderPadding=10,spaceBefore=7,spaceAfter=10))
story=[]
def p(text,style='BodyIBPM'):story.append(Paragraph(text,styles[style]))
def h(text):p(text,'SectionIBPM')
def table(rows,widths):
 data=[[Paragraph(escape(str(c)),styles['SmallIBPM']) for c in row] for row in rows]
 t=Table(data,colWidths=widths,hAlign='LEFT')
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e9eef5')),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#f8fafc'),colors.white]),('BOX',(0,0),(-1,-1),0.5,colors.HexColor('#d9e1eb'))]))
 story.append(t);story.append(Spacer(1,7))
def footer(canvas,doc):
 canvas.setFont('Helvetica',8);canvas.setFillColor(gray)
 canvas.drawString(48,30,'iBPM frontend handoff | 24 October 2026')
 canvas.drawRightString(564,30,str(doc.page))

p('iBPM<br/>Campus model &amp; Solana integration','TitleIBPM')
p('The committee runs the platform. Makers are standing appointments. There is no rotation or cycle settlement.')
h('1. Who can do what')
table([
 ['Role','Capabilities'],
 ['Admin committee','Markets, resolution, membership, maker appointments, funding, rewards, pause and upgrades. Sensitive actions need multiple approvals.'],
 ['Market maker','All trader actions, plus add/remove liquidity using persistent maker capital.'],
 ['Trader','Buy, sell, redeem winnings, submit market ideas and view. Must be enrolled.'],
 ['Observer','Read-only. No enrollment needed to read chain state. No starting balance or trading.'],
],[115,401])
p('We follow the permission matrix: only appointed makers provide liquidity. Committee membership does not automatically grant a personal trading account. There is no separate teacher or resolver tier.')
h('2. Keep the balances separate')
p('<b>Personal GIES:</b> the participant trades from their wallet token account. The configured starter is granted once; the default is 5,000 GIES.')
p('<b>Maker capital:</b> a separate program-controlled desk funds liquidity. The committee appoints a maker, then funds the desk. The default policy size is 15,000 GIES. Top-ups and clawbacks are explicit; the balance is never reset by a cycle.')
p('<b>Market vault:</b> holds collateral backing YES/NO claims. Winning claims redeem for 1 GIES each. Outcome claims are stored in position accounts, not separate SPL token mints.')
p('Trading fees benefit LP reserves. Fee-matched rewards are separate payouts approved by the committee, with a remaining emissions budget and a one-time claim ID. Rewards start disabled until configured.')
h('What is ready, and what comes next')
p('Campus permissions, the Solana program, the shared client and the generated IDL are implemented. The current web app still defaults to PostgreSQL. The frontend owner needs to connect wallet screens, chain reads, quotes and the indexer before switching to Solana.', 'SmallIBPM')
story.append(PageBreak())

p('Connect the frontend','TitleIBPM')
h('3. Start with the shared client')
p('Import <b>@workspace/solana-client</b>. The frontend already has the workspace dependency. Use the checked-in IDL at <b>solana/idl/ibpm.json</b>; it matches this source version. Keep Anchor 0.32.1 and web3.js 1.98.4. Do not mix in a web3 v2 client.')
p('The current program ID is <font name="Courier" size="8">EiMn8BEsdfuxEedNGi2vr12cjbKhGpq5Bq5N2ecCdnnM</font>. Use the same cluster, program address, binary and IDL. This address alone does not prove that this revision is deployed.')
h('4. Link, enroll, fund')
p('<b>1.</b> Keep campus login for the roster and off-chain account. Connect a wallet, then call <b>linkCampusWallet(token, publicKey, signMessage)</b>. The API verifies a short-lived message signature. A link proves ownership; it does not grant on-chain membership or money.')
p('<b>2.</b> The committee enrolls the verified wallet and calls <b>grantStarter</b> once. For a maker, appoint the maker and separately call <b>allocateMakerCapital</b>.')
p('<b>3.</b> Read the chain before enabling actions: no enrollment account = observer; <b>kind 0 = trader</b>, <b>kind 1 = maker</b>. Read committee membership from config. An inactive participant can still exit existing positions.')
h('5. Build and confirm a trade')
p('Create the Anchor provider from the connected wallet, then use these helpers. The complete setup is in <b>docs/integration.md</b>.')
code='''const client = createClient(provider);
const ix = await client.buy(
  wallet.publicKey, 0n, YES,
  gies("25"), gies(minTokensFromQuote)
);
const prepared = await prepareTransaction(
  connection, wallet.publicKey, [ix]
);
const signed = await wallet.signTransaction(
  prepared.transaction
);
const signature = await submitSigned(
  connection, signed, prepared, savePendingSignature
);
// Refetch market, position and wallet balances.'''
story.append(Preformatted(code,styles['CodeIBPM']))
p('Use a fresh chain quote and an explicit minimum output. Buys and sells both enforce that signed floor. Keep all amounts in BN/bigint with six decimals; use gies("12.345678"), not floating-point multiplication. The chain market ID is not the PostgreSQL row ID.')
p('Store the signature as soon as it is submitted. A confirmation timeout is an unknown result. Check that signature before offering a second submission. Show success only after confirmation and account readback.', 'SmallIBPM')
story.append(PageBreak())

p('Committee flow &amp; cutover','TitleIBPM')
h('6. Multiple people sign one transaction')
p('The program supports 2-7 committee members. Routine actions require at least two signatures. Resolution, committee changes, capital clawbacks, rewards and upgrades use the sensitive threshold. Any one member can pause new risk; unpausing needs routine approval.')
p('Build with <b>client.program.methods</b> and <b>.remainingAccounts(committeeSigners(payer, members))</b>. Members sign the <b>same transaction message</b>; public keys alone do not count. An expired blockhash requires fresh signatures. Private keys stay in member wallets.')
p('Database-mode committee proposals are a separate approval mechanism. They do not count as signatures on a Solana transaction. Resetting a committee account password also needs committee approval.')
h('7. Index the chain; keep app metadata off-chain')
p('Use the chain for balances, collateral, trades and resolution. Keep titles, source links, roster/cohorts and presentation data off-chain. Map market metadata by <b>cluster + program ID + market public key</b>.')
p('The <b>TradeExecuted</b> event supplies executed amounts, fees and reserves. Index by transaction signature and instruction/event location, backfill missed transactions, and reconcile to finalized state. Do not treat optimistic UI balances as settled balances.')
p('For rewards, the committee reviews the fee report and calls <b>payReward</b> with its evidence hash. The program checks the match and budget. Reject overlapping reports even if claim IDs differ.')
h('8. Before enabling Solana mode')
table([
 ['Owner','Remaining step'],
 ['Frontend','Wallet connection/linking; chain membership and balances; quote/slippage UI; trade, LP and redemption flows; pending/error states.'],
 ['Integration','Market metadata mapping, event history/indexer, backfill and finalized-state reconciliation.'],
 ['Committee / deployer','Deploy this build, initialize members/thresholds, transfer upgrade authority to config PDA, and verify readback. Configure economics and enroll/fund participants.'],
],[114,402])
p('The deployer must transfer program upgrade authority to the config PDA. Commands are in the full handoff; the local test exercises the transfer and committee-approved upgrade.')
p('Only after the wallet integration is ready, set <b>MARKET_BACKEND=solana</b>. Legacy financial endpoints then return 503, which prevents the app from using a second database ledger. Use a fresh campus database; beta balances and old on-chain accounts need a reviewed migration.')
p('<b>Validation:</b> web build/type checks, isolated API tests, Rust/client tests and 13 local-validator scenarios pass. No public-cluster deployment, production migration or live authority transfer was performed. Browser automation was unavailable for rendered UI review.', 'SmallIBPM')
p('Full account lists, code examples and operator steps: <link href="https://github.com/sahibbedi/iBlock-Prediction-Market/blob/main/docs/integration.md" color="#dd4828">docs/integration.md</link>. Working transaction examples: <b>solana/tests/ibpm.ts</b>.', 'SmallIBPM')

doc=SimpleDocTemplate(str(OUT),pagesize=(612,792),rightMargin=48,leftMargin=48,topMargin=43,bottomMargin=48,title='iBPM Campus Model and Solana Integration',author='iBPM')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
print(OUT)

"""Create a Filipino deployment handbook with code-drawn sample screens.

No real passwords, private keys, employee records or original screenshots are read.
The sample panels are deliberately labelled illustrations, not captured evidence.
"""
import os
import sys
import re
import textwrap
from pathlib import Path
from xml.sax.saxutils import escape

sys.path.insert(0, str(Path(os.environ['TEMP']) / 'dja-deployment-guide-deps'))
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, Flowable,
    KeepTogether, Preformatted,
)
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

BASE = Path(__file__).resolve().parents[2]
OUT = BASE / 'output' / 'pdf' / 'Nuxt_Namecheap_Deployment_Gabay_May_Sample_Screens.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
for name, fn in [('Body', 'segoeui.ttf'), ('BodyBold', 'segoeuib.ttf'), ('Mono', 'consola.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(Path('C:/Windows/Fonts') / fn)))
pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyBold', italic='Body', boldItalic='BodyBold')

NAVY = colors.HexColor('#152b55')
BLUE = colors.HexColor('#2459da')
INK = colors.HexColor('#202c40')
MUTED = colors.HexColor('#56647a')
PALE = colors.HexColor('#eef3fb')
GREEN = colors.HexColor('#28673c')
WIDTH = 504
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleX', fontName='BodyBold', fontSize=28, leading=34, textColor=NAVY, spaceAfter=15))
styles.add(ParagraphStyle(name='HeadingX', fontName='BodyBold', fontSize=20, leading=25, textColor=NAVY, spaceAfter=12))
styles.add(ParagraphStyle(name='SubX', fontName='BodyBold', fontSize=11.5, leading=15, textColor=INK, spaceBefore=10, spaceAfter=5))
styles.add(ParagraphStyle(name='BodyX', fontName='Body', fontSize=10.5, leading=15, textColor=INK, spaceAfter=7))
styles.add(ParagraphStyle(name='SmallX', fontName='Body', fontSize=8.5, leading=11.5, textColor=MUTED, spaceAfter=6))
styles.add(ParagraphStyle(name='CellX', fontName='Body', fontSize=9, leading=12, textColor=INK))
styles.add(ParagraphStyle(name='CellHeadX', fontName='BodyBold', fontSize=9, leading=12, textColor=colors.white))
styles.add(ParagraphStyle(name='CodeX', fontName='Mono', fontSize=8.1, leading=11, textColor=INK, spaceAfter=7, leftIndent=8))

STORY = []
PAGE_TITLES = []
def p(s, style='BodyX'):
    return Paragraph(s, styles[style])
def para(s):
    STORY.append(p(s))
def sub(s):
    STORY.append(p(s, 'SubX'))
def note(s):
    STORY.append(p(s, 'SmallX'))
def steps(items):
    for i, s in enumerate(items, 1):
        STORY.append(p(f'<b>{i}.</b> {s}'))
def code(text, shell=None):
    if shell:
        note(shell)
    # Explicit line breaks in source remain copyable; a long path can also wrap visually.
    lines = []
    for line in text.strip('\n').splitlines():
        lines.extend(textwrap.wrap(line, width=96, replace_whitespace=False, drop_whitespace=False,
                                   break_long_words=True, break_on_hyphens=False) or [''])
    STORY.append(Preformatted('\n'.join(lines), styles['CodeX']))
def table(rows, widths=None):
    vals = [[p(escape(str(cell)), 'CellHeadX' if i == 0 else 'CellX') for cell in row] for i, row in enumerate(rows)]
    t = Table(vals, colWidths=widths, hAlign='LEFT', repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, PALE]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 9),
        ('RIGHTPADDING', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LINEBELOW', (0, 0), (-1, 0), .5, NAVY),
        ('LINEBELOW', (0, 1), (-1, -1), .3, colors.HexColor('#dce4ef')),
    ]))
    STORY.extend([t, Spacer(1, 10)])
def qa(question, answer):
    sub('Tanong mo')
    para(f'<b>{question}</b> {answer}')
def page(title):
    if STORY:
        STORY.append(PageBreak())
    PAGE_TITLES.append(title)
    STORY.append(p(f'{len(PAGE_TITLES):02d}  {title}', 'HeadingX'))

class SampleScreen(Flowable):
    def __init__(self, title, rows=None, terminal=None, action=None, height=None, accent=BLUE):
        Flowable.__init__(self)
        self.title, self.rows, self.terminal, self.action = title, rows or [], terminal, action
        self.width = WIDTH
        self.height = height or (73 + 28 * len(self.rows) + (34 if action else 0))
        if terminal is not None:
            self.height = height or (65 + len(terminal) * 17)
        self.accent = accent
    def draw(self):
        c = self.canv
        c.setFillColor(colors.HexColor('#f8fafd'))
        c.setStrokeColor(colors.HexColor('#cbd5e4'))
        c.roundRect(0, 0, self.width, self.height, 8, fill=1, stroke=1)
        c.setFillColor(NAVY)
        c.roundRect(0, self.height - 32, self.width, 32, 8, fill=1, stroke=0)
        c.rect(0, self.height - 32, self.width, 12, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.setFont('BodyBold', 9.2)
        c.drawString(12, self.height - 21, self.title)
        c.setFont('Body', 7)
        c.drawRightString(self.width - 11, self.height - 20, 'SAMPLE SCREEN')
        if self.terminal is not None:
            c.setFillColor(colors.HexColor('#111a29'))
            c.rect(9, 24, self.width - 18, self.height - 65, fill=1, stroke=0)
            y = self.height - 51
            c.setFont('Mono', 8.1)
            for line in self.terminal:
                c.setFillColor(colors.HexColor('#d8f3dc') if ('OK' in line or 'ok' in line or 'found' in line) else colors.HexColor('#e7ebf4'))
                c.drawString(17, y, line)
                y -= 17
        else:
            y = self.height - 55
            for left, right in self.rows:
                c.setFillColor(MUTED)
                c.setFont('Body', 8.6)
                c.drawString(13, y, left)
                c.setFillColor(INK)
                c.setFont('BodyBold', 8.6)
                c.drawString(168, y, right)
                c.setStrokeColor(colors.HexColor('#e0e6f0'))
                c.line(13, y - 10, self.width - 13, y - 10)
                y -= 28
            if self.action:
                c.setFillColor(self.accent)
                c.roundRect(13, 29, min(290, pdfmetrics.stringWidth(self.action, 'BodyBold', 9) + 26), 25, 4, fill=1, stroke=0)
                c.setFillColor(colors.white)
                c.setFont('BodyBold', 9)
                c.drawString(25, 37, self.action)
        c.setFillColor(MUTED)
        c.setFont('Body', 7)
        c.drawString(12, 10, 'Illustration lamang. Hindi aktuwal na capture o patunay ng server status.')

def screen(title, rows=None, terminal=None, action=None, height=None):
    STORY.extend([Spacer(1, 4), SampleScreen(title, rows, terminal, action, height), Spacer(1, 10)])

# All project identifiers below are non-secret values already used in the session.
page('Gabay sa Nuxt deployment sa Namecheap')
STORY[-1] = p('Gabay sa Nuxt deployment sa Namecheap', 'TitleX')
para('Nuxt at Vue source code, Node.js hosting, MySQL o MariaDB, phpMyAdmin, Google login, SSH keys, at private GitHub repository.')
para('Para kay Jhoncharls at sa susunod mong system. Ito ang inayos na walkthrough ng ginawa natin noong Nobyembre 15 at 16, 2026. May sample screens, commands, sagot sa mga tanong mo, at checkpoints bago lumipat sa susunod na step.')
screen('Ang buong deployment flow', [
    ('PC mo', 'Local development -> deployment copy'),
    ('Namecheap', 'Domain -> Node app -> Linux build'),
    ('Data', 'Database import + hiwalay na private files'),
    ('Access', 'Environment -> Google/SMTP -> SSH key'),
    ('Code history', 'Private GitHub -> review -> future release'),
])
sub('Paano basahin ang guide')
para('Sundin ang tamang pagkakasunod. Ang mga halimbawa ay gumagamit ng aktuwal nating domain at paths. Sa bagong project, palitan ang mga iyon ayon sa worksheet. Ang <b>****</b> ay placeholder: ikaw ang maglalagay ng tunay na secret sa tamang private field.')
para('<b>Nuxt ang application framework at .vue ang component files.</b> Node.js ang nagpapatakbo sa production build. Ang phpMyAdmin ay pang-manage ng database; hindi doon pinapatakbo ang Vue app.')
note('Lahat ng screen panel sa guide ay generated illustrations. Walang totoong password, JWT value, OAuth client secret, private key, o personal employee data na inilagay.')

page('Mga bahagi at current project values')
table([
    ['Bahagi', 'Ginamit sa deployment natin'],
    ['Live URL', 'https://pmstest.jccuasito.top'],
    ['cPanel at SSH server', 'premium198.web-hosting.com'],
    ['cPanel user / SSH port', 'jccunkmk / 21098'],
    ['Local development', 'D:/MyFiles/CODE/pbsystem/pbsystem'],
    ['Local deployment copy', 'D:/MyFiles/CODE/pbsystem/pbsystem-namecheap'],
    ['Live app root', '/home/jccunkmk/pmstest'],
    ['Public document root', '/home/jccunkmk/pmstest.jccuasito.top'],
    ['Private storage root', '/home/jccunkmk/pmstest-private'],
    ['Database / dedicated user', 'jccunkmk_pbsystem / jccunkmk_jccuasito'],
    ['Observed Node / database engine', '24.22.3 / MariaDB 11.4.13'],
    ['Startup file', 'deployment/namecheap/app.js'],
    ['GitHub repository', 'jccuasito/pbsystem-namecheap (Private)'],
], [150, 354])
para('Ang dating payroll.jccuasito.top, pbsystem-app, at jccunkmk_payroll ay mula sa naunang reset na setup. <b>Huwag gamitin ang lumang paths</b> para sa kasalukuyang pmstest deployment.')
note('Sa bagong system, hiwalay na pangalan, domain, database, private storage, repository, at secrets ang gamitin. Hindi universal command values ang mga nasa table.')

page('Local folder kumpara sa live server')
screen('VS Code workspace at terminal', [
    ('Explorer folder', 'pbsystem-namecheap (LOCAL sa PC)'),
    ('Local terminal prompt', 'PS D:\\MyFiles\\CODE\\pbsystem\\...>'),
    ('SSH terminal prompt', '[jccunkmk@premium198 ~]$'),
    ('Remote app folder', '/home/jccunkmk/pmstest'),
])
steps([
    'Gamitin ang <b>pbsystem</b> para sa ordinaryong localhost development.',
    'Gamitin ang <b>pbsystem-namecheap</b> bilang hiwalay na deployment source copy.',
    'Buksan ang deployment copy sa bagong window gamit ang command sa ibaba.',
    'I-check lagi kung local PowerShell o remote SSH shell ang terminal bago mag-command.',
])
code('code -n "D:\\MyFiles\\CODE\\pbsystem\\pbsystem-namecheap"', 'LOCAL POWERSHELL')
qa('Galing ba sa Namecheap ang folder na nasa Explorer?', 'Hindi. Local copy iyon sa PC. Ang SSH terminal lamang ang remote; hindi nito ginagawang remote files ang local Explorer.')
para('<b>Save ay hindi Deploy.</b> Hindi awtomatikong nag-a-upload ang edits. Hindi rin required ang full VS Code Remote-SSH para makapag-upload, build, at restart gamit ang ordinaryong SSH.')

page('Ihanda ang source release')
screen('Local deployment folder', [
    ('Isama', 'app, components, server, shared, assets'),
    ('Isama', 'package.json + package-lock.json + config'),
    ('Huwag isama', '.env, .data, .private-transfer, SSH keys'),
    ('Huwag isama', 'node_modules, .output, old ZIPs/backups'),
    ('Upload package noon', 'UPLOAD-SOURCE.zip'),
])
steps([
    'Gumawa ng reviewed deployment copy mula sa working source. Panatilihin ang lockfile para maulit ang dependency versions.',
    'Gumawa ng ZIP na ang app files ay direktang nasa root ng archive; iwasan ang sobrang nested folder.',
    'I-check ang entries bago upload. Hindi sapat ang .gitignore kung mano-manong i-ZIP ang buong folder.',
    'Sa susunod na release, gumawa ng bagong package mula sa current committed source; hindi nag-a-update ang lumang ZIP kapag nag-edit ka.',
])
para('Sa audit natin, magkapareho ang UPLOAD-SOURCE.zip at .release/pbsystem-namecheap-source.zip. Private recovery material ang .private-transfer; hindi ito source na dapat isabay sa deployment o GitHub.')
qa('Makalat ba ang maraming folders?', 'Normal ang Nuxt source folders. Ang dapat hiwalay at malinaw ang label ay backups, transfer archives, at generated outputs.')

page('Domain at HTTPS sa cPanel')
screen('cPanel Domains', [
    ('Domain', 'pmstest.jccuasito.top'),
    ('Share document root', 'Hindi naka-check'),
    ('Document root', '/home/jccunkmk/pmstest.jccuasito.top'),
    ('App URL', 'https://pmstest.jccuasito.top'),
], action='Create domain / verify SSL')
steps([
    'Sa cPanel Domains, gumawa ng subdomain na may sarili nitong document root.',
    'I-check na tama ang DNS at may valid SSL certificate sa target domain.',
    'Buksan ang HTTPS URL. I-check din na ang HTTP ay nagre-redirect sa HTTPS.',
    'Itugma mamaya ang Node application URL, APP_URL, at Google authorized origin sa iisang hostname.',
])
qa('Puwede bang gamitin ang root ng main website?', 'Sa setup natin, hiwalay na subdomain at document root ang ginamit para hindi mahalo sa main website.')
note('Ang app source ay nasa /home/jccunkmk/pmstest, hiwalay sa public document root. Ang aktuwal na web routing ay hinahawakan ng cPanel/Passenger.')

page('Gumawa ng Node application')
screen('cPanel Setup Node.js App', [
    ('Node.js version', '24.x - observed 24.22.3'),
    ('Application mode', 'Production'),
    ('Application root', 'pmstest'),
    ('Application URL', 'pmstest.jccuasito.top /'),
    ('Application startup file', 'deployment/namecheap/app.js'),
], action='Save')
steps([
    'Buksan ang Setup Node.js App at piliin ang supported Node version na pasado sa dependency engines.',
    'Ilagay ang application root at tamang subdomain. Relative sa home folder ang root field.',
    'Itakda ang startup file ng project. Sa atin ay CommonJS wrapper na nag-i-import ng .output/server/index.mjs.',
    'I-save. Hindi sapat na created na ang app: kailangan pa ng source, dependencies, configuration, at successful build.',
])
para('Ginamit natin ang Production mode. Hindi <b>npm run dev</b> ang live service. Ang pangalan at startup file ay project-specific; huwag kopyahin sa ibang project kung wala roon ang file.')
note('Reference [1]: Namecheap Node.js application guide. Huwag magdagdag ng PM2 kasabay ng Passenger sa shared-hosting setup na ito.')

page('Upload at extract sa app root')
screen('cPanel File Manager', [
    ('Current folder', '/home/jccunkmk/pmstest'),
    ('Uploaded archive', 'UPLOAD-SOURCE.zip - 100%'),
    ('Extract destination', '/home/jccunkmk/pmstest'),
    ('Root files after extract', 'package.json, package-lock.json, app, server'),
], action='Upload -> Extract -> Reload')
steps([
    'Sa File Manager, pumunta sa app root. Upload ang reviewed source ZIP at hintaying 100%.',
    'Bumalik sa File Manager at Extract sa parehong app root.',
    'I-check na direktang nasa app root ang package.json; hindi pmstest/another-folder/package.json.',
    'Huwag i-extract ang private employee documents sa public_html o sa public subdomain folder.',
])
qa('Tama na ba kapag 100% na?', 'Upload lang ang tapos. Kailangan pang i-extract at i-check ang folder layout bago mag-install at build.')
para('Ang archive natin ay mga 4.25 MB. Sample size lamang iyon; hindi kailangang kapareho ang laki ng susunod mong system.')

page('Install dependencies sa Linux')
screen('cPanel Run NPM Install / Terminal', terminal=[
    '$ source /home/jccunkmk/nodevenv/pmstest/24/bin/activate',
    '$ cd /home/jccunkmk/pmstest',
    '$ npm install-scripts ls',
    '$ npm install-scripts approve bcrypt esbuild',
    '$ npm rebuild bcrypt esbuild --foreground-scripts',
    'rebuilt dependencies successfully',
], height=176)
steps([
    'Gamitin ang Run NPM Install ng Node app o ang reviewed installation command sa activated Node environment.',
    'Sa ginawa natin, exit 0 ang install ngunit may blocked install scripts para sa bcrypt at esbuild.',
    'Inaprubahan lamang natin ang dalawang package na kailangan at ni-rebuild ang mga iyon. Huwag basta mag-approve ng lahat.',
    'I-test ang native packages sa server bago ang Nuxt build.',
])
code('''node -e '
const b=require("bcrypt");
const h=b.hashSync("deployment-check",4);
if(!b.compareSync("deployment-check",h)) throw new Error("bcrypt failed");
console.log("bcrypt OK");
'
node -e '
require("esbuild").transformSync("const n=1",{loader:"js"});
console.log("esbuild OK");
' ''', 'REMOTE BASH - multiline JavaScript sa single quotes')
qa('Maraming unapproved scripts, error ba lahat?', 'Hindi. Kasama sa listing ang prepare scripts na hindi lahat kailangang patakbuhin. Ang aktuwal na install/build result at functional check ang basehan.')
note('Ang install-scripts commands ay para sa npm version natin noon, 11.19.1. Sa ibang version, sundin ang supported package-approval mechanism. Huwag i-upload ang Windows node_modules sa Linux.')

page('Database Wizard steps 1 at 2')
screen('Database Wizard - Create database and user', [
    ('Account prefix', 'jccunkmk_'),
    ('Database suffix', 'pbsystem'),
    ('Full database name', 'jccunkmk_pbsystem'),
    ('User suffix / full name', 'jccuasito / jccunkmk_jccuasito'),
    ('Database password', '****  (bagong dedicated database password)'),
], action='Next Step -> Create User')
steps([
    'Sa cPanel Database Wizard, ilagay ang database suffix at pindutin ang Next Step.',
    'Gumawa ng dedicated database user. Magtakda ng strong password at itago nang private.',
    'Itala ang <b>buong prefixed database name at username</b>; iyon ang ilalagay sa Node environment.',
])
qa('Pareho ba ang database password at cPanel password?', 'Hindi. Magkaibang credentials. Ang database password ay para sa DB_USER at DB_PASSWORD; cPanel password ang pang-hosting/SSH password login.')
para('Ang phpMyAdmin sa hosting ay maaaring magpakita ng server na localhost:3306. Hosting database iyon, hindi ang XAMPP database sa PC mo.')

page('Database Wizard step 3 at completion')
screen('Step 3 - Add user to database', [
    ('User', 'jccunkmk_jccuasito'),
    ('Database', 'jccunkmk_pbsystem'),
    ('Privileges sa database na ito', '[x] ALL PRIVILEGES'),
    ('Result sa step 4', 'User was added to the database'),
], action='Make Changes -> Next Step')
steps([
    'Siguraduhing tama ang user at database na magkapareha.',
    'Para sa initial setup natin, piliin ang ALL PRIVILEGES <b>sa dedicated database lang</b>.',
    'Pindutin ang Make Changes, pagkatapos Next Step at tingnan ang success message.',
])
qa('Ano ang ilalagay sa step 3?', 'Permissions ang pinipili rito, hindi bagong database name. Hindi ito katumbas ng global root o server administrator privileges.')
para('Kapag nire-create ang database sa initial troubleshooting, kailangang i-check muli kung naka-assign ang dedicated user. Hindi ibig sabihin na naroon pa rin ang assignment pagkatapos mag-delete at recreate.')
note('Gawin lamang ang destructive reset sa confirmed disposable initial target. Sa used live database, kailangan ng backup at reviewed migration; hindi Wizard reset ang ordinaryong update.')

page('I-export ang localhost database')
screen('LOCAL phpMyAdmin - Export', [
    ('Selected database', 'pbsystem (localhost sa PC)'),
    ('Export format', 'SQL'),
    ('Contents', 'Structure + data; include needed DB objects'),
    ('Saved export example', 'pbsystem (deployment__test1).sql'),
], action='Export -> save private copy')
steps([
    'Buksan ang local phpMyAdmin at piliin ang tamang database, hindi ibang test database.',
    'Export ang structure at data bilang SQL. I-check na kasama ang required views, triggers, indexes, at constraints.',
    'Itabi ang original export nang hindi binabago. Kung may hosting compatibility fix, gumawa ng derived copy.',
    'Huwag ilagay ang SQL export sa public web folder o GitHub. May personal at payroll information ito.',
])
para('Ang export na ginamit mo ay nasa D:/MyFiles/CODE/pbsystem/backup/nov16/. Ang source migrations sa database/ folder ay ibang bagay sa full data export.')
qa('Tama ba ang SQL file dahil bagong download?', 'Hindi pa sapat ang filename o download date. Kailangan itong ma-import, ma-verify ang data at DB objects, at ma-test ang application behavior.')
note('Reference [2]: phpMyAdmin import/export. Sa bagong project, huwag basta mag-import ng CREATE DATABASE o USE statements na tumutukoy sa maling local name.')

page('I-import sa hosting phpMyAdmin')
screen('HOSTING phpMyAdmin - Import', [
    ('Selected database', 'jccunkmk_pbsystem'),
    ('Final file na gumana', 'pbsystem-deployment-test1-namecheap-v2.sql'),
    ('Format', 'SQL'),
    ('Observed completed result', 'Import finished - 438 queries executed'),
], action='Choose file -> Import / Go')
steps([
    'Buksan ang phpMyAdmin mula sa hosting cPanel at piliin ang dedicated target database.',
    'Piliin ang reviewed SQL file. Sa ating case, ang final compatible copy ay may suffix na namecheap-v2.',
    'Hintaying matapos at basahin ang buong result. Ang error sa gitna ay maaaring may naiwan nang imported tables.',
    'Pagkatapos ng success, i-check ang data, views, triggers, foreign keys, at application workflows.',
])
para('<b>438 queries</b> ang result ng particular nating export, hindi required count para sa lahat ng system. Huwag i-import muli ang buong dump sa used live database para lamang mag-update ng code.')
qa('I-drop ko na lang ba ang database kapag may error?', 'Noon, disposable initial import pa ang target. Ngayon may bagong live records na, kaya hindi na iyon ligtas na ordinaryong troubleshooting step.')

page('SQL errors na naayos natin')
table([
    ['Naging error', 'Dahilan at naging solution'],
    ['#1227 SET USER privilege required', 'May view na DEFINER=root@localhost mula sa local export. Sa derived import, ginamit ang DEFINER=CURRENT_USER para sa deployment owner.'],
    ['#1901 generated AttendanceScopeBatchID', 'May STORED generated column na umaasa sa BatchID na may cascading foreign key. Sa exact schema natin, VIRTUAL ang compatible variant na na-test.'],
    ['Partial import', 'Maaaring may tables/data na bago pa dumating ang error. I-review ang target state bago mag-retry.'],
], [172, 332])
code('/* Case-specific excerpt; hindi universal fix */\nDEFINER=CURRENT_USER\n\n`AttendanceScopeBatchID` int(11)\n  GENERATED ALWAYS AS (coalesce(`BatchID`,0)) VIRTUAL')
para('Sa exact attendance schema, pinanatili ang expression, unique scope index, at foreign-key cascade semantics. Na-test ang duplicate protection at update/delete behavior sa isolated database bago gamitin ang final copy.')
qa('Hindi ba makakasagabal sa production ang fix?', 'Successful import lamang ay hindi sapat. Ang compatibility change ay na-test para sa schema natin; hindi ito blanket instruction na palitan ang lahat ng STORED columns sa ibang system.')
note('Source references [7] at [8] para sa MariaDB behavior. Original SQL data export ay hindi binago. Para sa ibang application, suriin ang engine version at exact DDL bago mag-transform.')

page('Private files at persistent storage')
screen('File Manager - private storage', [
    ('Folder', '/home/jccunkmk/pmstest-private'),
    ('Subfolder', 'profile-images/'),
    ('Subfolder', 'employee-government-ids/'),
    ('Subfolder', 'payslip-archive/'),
    ('Subfolder', 'database-backups/'),
], action='Upload private ZIP -> Extract here')
steps([
    'Gumawa ng private root sa home directory, sa labas ng public document roots.',
    'I-upload ang private-file ZIP at i-extract ang tatlong attachment folders direkta sa private root.',
    'Gumawa rin ng database-backups directory. I-check na readable/writable ito ng app user kung kailangan.',
    'Itugma ang absolute storage paths sa environment variables sa mga susunod na pahina.',
])
code('mkdir -p /home/jccunkmk/pmstest-private/database-backups', 'REMOTE BASH')
qa('Kasama ba ang photos at IDs sa SQL backup?', 'Hindi. Ang SQL ay database data at file references. Hiwalay na backup at transfer ang actual images, IDs, at archived PDFs.')
para('Sa transfer natin, 16 files ang na-verify locally bago i-upload. Hindi patunay ng complete backup ang pagkakaroon lamang ng folders; i-test ang authorized upload at retrieval sa live app.')

page('Environment variables para sa database at URL')
screen('Node.js App - Environment variables', [
    ('APP_URL', 'https://pmstest.jccuasito.top'),
    ('DB_HOST / DB_PORT', 'localhost / 3306'),
    ('DB_NAME', 'jccunkmk_pbsystem'),
    ('DB_USER', 'jccunkmk_jccuasito'),
    ('DB_PASSWORD', '****  (dedicated DB password)'),
], action='DONE bawat row -> SAVE sa itaas')
steps([
    'Sa Node app, Add Variable at ilagay ang exact uppercase name at value.',
    'Pindutin ang Done para matapos ang bawat row.',
    'Pindutin din ang <b>Save sa itaas ng application settings</b>. Hindi sapat ang typed o Done lang.',
    'Mag-Restart pagkatapos ng saved environment changes para magamit ng bagong app process.',
])
para('Itakda rin ang NUXT_APP_URL sa parehong HTTPS URL kung ginagamit ang runtime configuration na iyon. NODE_ENV ay production sa selector/wrapper natin; DEBUG=false at TZ=Asia/Manila ang ginamit.')
qa('Bakit may values sa screen pero nawawala sa startup?', 'Nangyari sa atin na zero saved variables ang selector settings. Matapos ma-Save at restart, naging ready ang app.')

page('Secrets at private path variables')
table([
    ['Name', 'Value o hint'],
    ['JWT_SECRET', '**** - fresh strong random secret, generated privately'],
    ['NUXT_JWT_SECRET', '**** - parehong value sa JWT_SECRET para sa setup natin'],
    ['PROFILE_IMAGE_STORAGE_DIR', '/home/jccunkmk/pmstest-private/profile-images'],
    ['GOVERNMENT_ID_STORAGE_DIR', '/home/jccunkmk/pmstest-private/employee-government-ids'],
    ['PAYSLIP_ARCHIVE_STORAGE_DIR', '/home/jccunkmk/pmstest-private/payslip-archive'],
    ['DB_BACKUP_DIR', '/home/jccunkmk/pmstest-private/database-backups'],
    ['DB_AUTO_BACKUP', 'false - hindi pa configured/tested ang scheduled backup'],
], [192, 312])
sub('Gumawa ng bagong random JWT secret')
code('node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"', 'REMOTE NODE ENVIRONMENT - huwag i-screenshot ang output')
para('Ang generated output line lang ang kinokopya sa secret fields, hindi ang command o shell prompt. Hindi cPanel password at hindi database password ang JWT secret. Itago ito privately; huwag ilagay sa Git o sa screenshots.')
qa('Puwede bang burahin sa memory ang password na na-post?', 'Hindi natin mabubura ang naipadalang chat images sa pamamagitan ng pagsasabi lamang nito. Sa guide, puro masked placeholders ang ginagamit. Sa actual app, pribado ang tunay na values.')
note('Ang .env.example ay template lamang. Huwag palitan ang placeholders nito ng production secrets bago mag-commit.')

page('I-build ang Nuxt sa hosting server')
screen('Terminal - Linux production build', terminal=[
    '[pmstest (24)] $ npm run build:hosting',
    'Nuxt production build ...',
    '.output/server/index.mjs',
    'Build complete!',
], height=146)
code('source /home/jccunkmk/nodevenv/pmstest/24/bin/activate\ncd /home/jccunkmk/pmstest\nNITRO_PRESET=node-server \\\nAPP_URL=https://pmstest.jccuasito.top \\\nNUXT_APP_URL=https://pmstest.jccuasito.top \\\nnpm run build:hosting', 'REMOTE BASH - ang backslash ay line continuation')
steps([
    'Activate ang Node environment na ipinapakita mismo ng cPanel selector.',
    'Pumunta sa app root bago mag-build. Ang build:hosting ay custom script ng deployment copy natin.',
    'Hintaying matapos at bumalik ang shell prompt. Tingnan ang exit status at final build result.',
])
para('Successful ang actual Linux build natin, mga 1 minuto at 29 segundo. May warnings ngunit walang fatal build error. Ang restart ay pagkatapos lamang ng successful output.')
note('Sa ibang project, kung walang build:hosting script, gamitin ang project-supported build command at Node server preset. Huwag i-upload ang Windows .output bilang Linux release nang walang compatibility verification.')

page('Save restart at startup troubleshooting')
screen('Startup log - halimbawa ng missing configuration', terminal=[
    '[startup] Configure production environment fields:',
    'DB_HOST, DB_USER, DB_NAME, DB_PASSWORD, JWT_SECRET, APP_URL,',
    'PROFILE_IMAGE_STORAGE_DIR, GOVERNMENT_ID_STORAGE_DIR,',
    'PAYSLIP_ARCHIVE_STORAGE_DIR, DB_BACKUP_DIR',
], height=146)
steps([
    'Sa Node app, i-save ang settings at gamitin ang Start o Restart.',
    'Kung 503 ang site, tingnan muna ang app log; huwag agad mag-drop ng database.',
    'Kung missing-variable names ang log, i-check ang Save state, exact names, at blank/placeholder values.',
    'Kapag na-save na, restart at ulitin ang readiness test. Lumang log lines ay hindi sapat para patunayang present pa ang error.',
])
code('tail -n 80 /home/jccunkmk/pmstest/stderr.log\n# Para sa fresh log entries habang inuulit ang request:\ntail -n 0 -F /home/jccunkmk/pmstest/stderr.log', 'REMOTE BASH - Ctrl+C para umalis sa tail follow')
qa('May warning na walang unique column sa phpMyAdmin, sira ba?', 'Sa SELECT VERSION o aggregate COUNT result, normal na walang editable unique row identity. Hindi iyon patunay na nawawala ang table primary keys.')
para('Naging 503 muna ang app natin dahil hindi pa saved ang required environment. Pagkatapos ay bumalik ang readiness endpoint sa status ok.')

page('Health at database verification')
screen('Browser - https://pmstest.jccuasito.top/health/ready', terminal=[
    '{"status":"ok"}',
    '',
    'Observed initial DB checks:',
    'Employees = 200   AttendanceRows = 85   ScopeMismatches = 0',
], height=146)
code('SELECT VERSION() AS ServerVersion;\n\nSELECT (SELECT COUNT(*) FROM employee) AS Employees,\n       (SELECT COUNT(*) FROM attendance) AS AttendanceRows;\n\nSELECT COUNT(*) AS ScopeMismatches\nFROM attendance\nWHERE NOT (AttendanceScopeBatchID <=> COALESCE(BatchID, 0));', 'HOSTING phpMyAdmin SQL tab - read-only checks')
para('Ang /health/ready implementation natin ay nagche-check ng database readiness. Ang /health/live ay process health. Ang 200/85/0 ay initial snapshot results lamang; may nadagdag nang live employee kaya hindi na dapat piliting bumalik sa lumang counts.')
qa('All goods na ba kapag status ok?', 'Basic readiness lamang. Kailangan pa ng login, permissions, uploads, DTR/payroll computation, PDF/export, backup, at restore tests.')

page('Google login at authorized origins')
screen('Google Auth Platform - Web client', [
    ('JavaScript origin 1', 'http://localhost:3000'),
    ('JavaScript origin 2', 'https://pmstest.jccuasito.top'),
    ('Client ID', '****  (ID ng parehong web client)'),
    ('Client secret', '****  (private, server-side lamang)'),
], action='SAVE - mahalagang pindutin')
steps([
    'Buksan ang tamang Web application client sa Google Auth Platform.',
    'Panatilihin ang localhost origin at <b>magdagdag</b> ng live HTTPS origin. Walang path sa JavaScript origin.',
    'I-save sa Google Cloud. Ito ang nakalimutan natin noong lumabas ang origin_mismatch.',
    'Sa hosting, itugma ang GOOGLE_CLIENT_ID, NUXT_GOOGLE_CLIENT_ID, at NUXT_PUBLIC_GOOGLE_CLIENT_ID sa client; server-only ang GOOGLE_CLIENT_SECRET.',
])
qa('Maaapektuhan ba ang localhost kapag nag-add ng URL?', 'Hindi kung idadagdag mo lang ang live origin at iiwan ang localhost entry.')
para('Popup code flow ang current implementation natin. Iba ang <b>Authorized JavaScript origins</b> sa <b>redirect URIs</b>. Kung redirect flow ang ibang project, irehistro ang exact implemented callback URL; hindi universal callback ang root domain o /api/auth/google/callback.')
note('Error 400 origin_mismatch: i-check ang scheme, hostname, port, matching client ID, Save, at propagation. Reference [3] para sa popup at redirect flow distinction.')

page('Email verification at SMTP')
screen('Signup - sample email delivery failure', [
    ('Email', 'test.staff@example.com'),
    ('Password', '****  (application account password)'),
    ('First result', 'Account created; verification email not sent'),
    ('Second Create account', 'An account already exists for this email'),
], action='Recovery needed: resend verification')
para('Ito ang confusing flow na nakita mo: committed na ang account bago ang SMTP send. Kapag pumalya ang mail, nananatili ang account. Kaya duplicate na ang next signup attempt. Kahit Google-assisted signup, humihingi pa rin ng separate email verification ang current registration code natin.')
table([
    ['Environment variable', 'Hint'],
    ['GMAIL_USER', 'Sender Gmail ng system; maaaring iba sa bagong signup user'],
    ['GMAIL_APP_PASSWORD', '**** - sender App Password; hindi ordinaryong Gmail password'],
], [170, 334])
para('I-save ang SMTP settings, restart, at mag-test ng delivery sa controlled test account. Kung hindi pa rin gumana, tingnan ang SMTP error privately. May resend backend endpoint, pero hindi pa naayos ang kumpletong user-facing recovery controls sa signup screen.')
qa('I-delete ko ba para mag-signup ulit?', 'Hindi kailangang burahin para lang makakuha ng code. Resend/recovery ang tamang flow; kailangan pa nitong UI fix sa current build.')
note("Huwag markahan ang SMTP at signup recovery bilang completed hangga't hindi nasusubukan ang actual email delivery at recovery.")

page('Team access activation at delete label')
screen('Admin Team access - sample new account', [
    ('User', 'TEST STAFF'),
    ('Role / status', 'Viewer / Inactive'),
    ('Department', 'HR Department'),
    ('Available action', 'Reactivate account'),
    ('Delete user button', 'Hidden habang Inactive'),
], action='Review access -> activate only when appropriate')
para('Bagong self-signup accounts ay Inactive/Viewer sa current code. Pagkatapos ng email verification, kailangan pa ng Admin activation at tamang section permissions bago magamit ng staff.')
qa('Bakit nawala ang Delete user?', 'Lumalabas lamang ito sa ibang Active user. Ang current DELETE handler ay nagse-set lang ng Status=Inactive; hindi permanenteng tinatanggal ang row o email.')
para('Kaya maaaring magpakita ang signup ng account already exists kahit naka-Inactive na sa directory. Hindi solusyon sa duplicate registration ang kasalukuyang Delete user button. Kailangan ng malinaw na Deactivate label at hiwalay na reviewed policy kung magdadagdag ng permanent deletion.')
para('I-test ang Admin, Viewer, at employee portal gamit ang test accounts. Hindi sapat na nakatago ang buttons; dapat tumanggi rin ang server sa unauthorized requests.')

page('SSH connection at host fingerprint')
screen('VS Code local PowerShell - first SSH connection', terminal=[
    'PS D:\\...> ssh -p 21098 jccunkmk@premium198.web-hosting.com',
    'ED25519 key fingerprint is SHA256:... (public fingerprint)',
    'Are you sure you want to continue connecting? yes',
    "jccunkmk@premium198.web-hosting.com's password:",
    '[jccunkmk@premium198 ~]$',
], height=163)
code('ssh -p 21098 jccunkmk@premium198.web-hosting.com', 'LOCAL POWERSHELL')
steps([
    'Enable SSH sa cPanel Manage Shell kung disabled. Sa ating case, gumana ang SSH terminal login.',
    'Sa first connection, i-verify ang host fingerprint bago i-type ang buong yes. Hindi sapat ang y.',
    'Ilagay ang <b>cPanel password</b> kapag password login ang gamit. Walang characters na lalabas habang tina-type.',
])
para('Noon, tinangka ang /etc/ssh/ssh_host_ed25519_key.pub ngunit hindi available sa account environment. Nakuha natin ang same server key via loopback mula sa trusted cPanel Terminal:')
code('ssh-keyscan -T 10 -p 21098 -t ed25519 127.0.0.1 2>/dev/null \\\n  | ssh-keygen -lf - -E sha256', 'cPANEL TERMINAL - para sa same-server comparison')
note('Kapag magkaiba ang fingerprints, itigil at ipa-verify sa human hosting support. Generic AI reply o keyscan mula lang sa parehong untrusted client ay hindi independent verification. Connection closed noong una ay hindi pa patunay ng hosting ban.')

page('cPanel password reset at SSH restrictions')
screen('cPanel login - Reset Password', [
    ('cPanel login', 'https://premium198.web-hosting.com:2083/'),
    ('Username', 'jccunkmk'),
    ('Contact email', '****  (hosting account contact email)'),
    ('Security code / new password', '****  (ikaw lang ang maglalagay)'),
], action='Reset Password -> Send Security Code')
steps([
    'Kung hindi mo alam ang cPanel password dahil auto-login ka mula Namecheap, gamitin ang Reset Password sa cPanel login page.',
    'Ilagay ang cPanel username at contact email; sundin ang security-code verification.',
    'Gamitin ang bagong cPanel password sa main-account SSH/SFTP password login.',
])
qa('Maaapektuhan ba ang database at Node app?', 'Sa setup natin, hiwalay na dedicated DB user ang app. Hindi kailangang palitan ang DB_PASSWORD o JWT dahil lang sa cPanel password reset. I-update ang saved hosting login credentials kung mayroon.')
para('<b>Password reset</b> lamang ang ginawa, hindi reset o wipe ng buong cPanel account. Magkaiba rin ang SSH terminal at full VS Code Remote-SSH: ang huli ay nangangailangan ng VS Code Server/forwarding na hindi pa na-verify sa hosting plan natin.')
note('References [4] at [5]. Hindi required ang pag-upgrade sa VPS para lang masubukan ang ordinaryong SSH/SFTP deployment workflow.')

page('Gumawa ng SSH key sa local PC')
screen('LOCAL PowerShell - generate key pair', terminal=[
    'PS D:\\...> ssh-keygen -t ed25519 ...',
    'Enter passphrase (empty for no passphrase): ****',
    'Enter same passphrase again: ****',
    'Private: C:\\Users\\YOU\\.ssh\\pbsystem_namecheap',
    'Public:  C:\\Users\\YOU\\.ssh\\pbsystem_namecheap.pub',
], height=163)
code('ssh-keygen -t ed25519 \\\n  -f "$env:USERPROFILE\\.ssh\\pbsystem_namecheap" \\\n  -C "pbsystem-deploy"'.replace('\\\n', '`\n'), 'LOCAL POWERSHELL - backtick ang line continuation')
steps([
    'Gumamit ng bagong dedicated filename. Huwag i-overwrite ang existing key nang hindi sinusuri.',
    'Maglagay ng sariling passphrase at ulitin ito sa confirmation prompt. Walang echo ang typing.',
    'Itago ang private key sa PC; .pub file lang ang ipapadala sa hosting.',
])
qa('Para saan ang passphrase?', 'Proteksiyon sa private-key file. Hiwalay ito sa cPanel, database, at app-login passwords. Maaari itong i-cache ng SSH agent sa future setup; hindi pa natin na-configure iyon.')
note('Sa bagong project, puwedeng sariling key filename at comment ang gamitin. Huwag mag-generate muli sa existing path dahil lang sa connection issue.')

page('Import at authorize ang public key')
screen('cPanel SSH Access - Import Key', [
    ('Key name', 'pbsystem_namecheap'),
    ('Private key', '(blanko)'),
    ('Passphrase', '(blanko sa public-only import)'),
    ('Public key', 'ssh-ed25519 AAAA... pbsystem-deploy'),
], action='Import -> Manage -> Authorize')
code('Get-Content -LiteralPath \\\n  "$env:USERPROFILE\\.ssh\\pbsystem_namecheap.pub" \\\n  | Set-Clipboard'.replace('\\\n', '`\n'), 'LOCAL POWERSHELL')
steps([
    'Patakbuhin ang command sa local PowerShell. Normal na walang terminal output: nasa clipboard na ang public key.',
    'Sa cPanel SSH Access, Manage SSH Keys, Import Key. I-paste sa <b>public key</b> box gamit ang Ctrl+V.',
    'Iwang blanko ang private key at passphrase fields. Nasa PC lamang ang passphrase-protected private key.',
    'Pagkatapos ng Import, pumunta sa Public Keys list, Manage, at <b>Authorize</b>. Hindi sapat ang imported lang.',
])
qa('Walang lumabas pagkatapos ng Set-Clipboard?', 'Expected iyon. I-paste sa tamang box. Ang fingerprint na SHA256:... ay hindi ang buong public key na dapat i-import.')
note('Reference [6]: Namecheap SSH key import and authorization. Public key ang puwedeng i-share; huwag ang file na walang .pub.')

page('Subukan ang key login at Node environment')
screen('SSH key login - sample successful result', terminal=[
    'Enter passphrase for key ...pbsystem_namecheap: ****',
    '[jccunkmk@premium198 ~]$',
    '[pmstest (24)] $ pwd',
    '/home/jccunkmk/pmstest',
    '[pmstest (24)] $ node --version',
    'v24.22.3',
    'Production build found',
], height=197)
code('ssh -i "$env:USERPROFILE\\.ssh\\pbsystem_namecheap" `\n  -o IdentitiesOnly=yes `\n  -o PreferredAuthentications=publickey `\n  -p 21098 jccunkmk@premium198.web-hosting.com', 'LOCAL POWERSHELL')
code('source /home/jccunkmk/nodevenv/pmstest/24/bin/activate\ncd /home/jccunkmk/pmstest\npwd\nnode --version\ntest -f .output/server/index.mjs && echo "Production build found"', 'REMOTE BASH - pagkatapos makapasok')
para('Successful ang key login natin. Ang hinihinging passphrase ay para sa local private key; hindi cPanel password. Naka-login ka pa rin kung [jccunkmk@...]$ ang prompt. Gumamit ng bagong PowerShell terminal para sa local Git commands.')

page('Private GitHub code backup')
screen('GitHub - new repository', [
    ('Owner', 'jccuasito'),
    ('Repository name', 'pbsystem-namecheap'),
    ('Visibility', 'Private'),
    ('Initialize README / gitignore', 'Huwag kung may initial local commit na'),
], action='Create repository -> push existing commit')
para('Gumawa tayo ng separate Git repo sa deployment folder. Initial commit: <b>5d8c6d0</b>; 606 files. Excluded ang private transfers, secrets files, uploads, backups, at ZIPs. Source migrations sa database/ ay kasama. Hindi kinopya ang lumang development Git history.')
code('git -C "D:\\MyFiles\\CODE\\pbsystem\\pbsystem-namecheap" \\\n  push -u origin main'.replace('\\\n', '`\n'), 'LOCAL POWERSHELL - may existing origin na sa setup natin')
steps([
    'Gumawa ng empty private repository. Nang una ay Repository not found dahil hindi pa available ang target.',
    'Naging Public muna ang repo na ginawa mo. Settings, General, Danger Zone, Change visibility, Private ang correction.',
    'I-push muli. Sa latest actual screenshot, successful ang main -> main at tracking origin/main.',
])
qa('Backup na ba ng buong system ang GitHub?', 'Code history lamang. Hiwalay ang database, private uploads, server configuration, at secrets. Git push ay hindi automatic live deployment.')
note('Sa brand-new project: git init -b main, git add ng reviewed source, git commit, git remote add origin sa tamang repo, saka push. Huwag ulitin ang git init o add origin kung mayroon na. Reference [9].')

page('Pag update at pag trace ng live release')
screen('Release workflow - target setup, hindi pa automated', [
    ('1 Review', 'Local test + intentional code changes'),
    ('2 Version', 'Commit at push sa private repository'),
    ('3 Deploy', 'Upload code -> Linux build -> restart'),
    ('4 Verify', 'Health + affected workflows + permissions'),
    ('5 Record', 'Eksaktong deployed commit + release tag'),
])
para('<b>Hindi pa naka-set up</b> ang one-click VS Code deployment task, atomic publish, automatic rollback, at SSH-agent caching. Hindi sapat ang SSH key login o GitHub push para sabihing automatic na ang updates.')
para('Ang initial repo ay local prepared source snapshot. Hindi pa independently naikumpara ang lahat ng source nito sa running server. Mag-record lamang ng live release tag kapag alam ang exact deployed commit at pasado ang checks.')
steps([
    'Panatilihin ang previous working application build at backup bago mag-live change.',
    'Sa automated workflow na gagawin pa, i-build ang candidate nang hiwalay sa active output bago publish.',
    'Huwag isabay sa code upload ang .env, node_modules, private storage, o lumang full SQL dump.',
    'Ang rollback ng code ay hindi rollback ng database schema o payroll transactions.',
])
qa('Bakit hiwalay na conversation?', 'Para hindi mahalo ang development at live-deployment context. Hindi requirement ng system ang chat separation, at kailangan ng handoff summary dahil hindi automatic ang context transfer.')

page('Functional acceptance at backup testing')
table([
    ['Test', 'Pass criteria'],
    ['Login at logout', 'Google at password login; protected pages denied after logout'],
    ['Employee at deployment', 'Add/edit/search/refresh ng TEST records; tamang agency/site'],
    ['DTR at attendance', 'Tamang cutoff, dates, OT, absences, duplicate handling'],
    ['Payroll at billing', 'Manual comparison ng gross, deductions, net pay at invoice totals'],
    ['Private files at exports', 'Authorized upload/download, PDF at print; guest denied'],
    ['Roles', 'Admin, Viewer, employee portal: tamang server-side restrictions'],
    ['Restart at remote device', 'Data/files persist; gumagana kahit off ang local dev PC'],
    ['Backup at restore', 'SQL + private files + isolated restore; may off-account copy'],
], [145, 359])
para('Gumamit ng malinaw na TEST records. Ang finalization, restore, bulk imports, at concurrent payroll writes ay sa isolated staging database muna. Hindi sapat ang pag-add ng isang employee para matest ang buong business workflow.')
para('Sa Admin Settings Backups, puwedeng i-test ang manual create at download. Last known setup ay DB_AUTO_BACKUP=false; hindi pa verified ang scheduled backup. SQL backup ay hindi kasama ang private attachment files.')
qa('Puwede bang i-test ang restore sa live?', 'Hindi para lang sa practice. Gamitin ang hiwalay na recovery database at private storage copy; huwag isugal ang used live payroll data.')

page('Mga madalas mong tanong')
table([
    ['Tanong', 'Sagot'],
    ['Aling password sa SSH?', 'cPanel password sa password login; key passphrase kapag key login.'],
    ['Walang characters habang typing?', 'Normal para sa password at passphrase prompts.'],
    ['Ano ang yes/no/fingerprint prompt?', 'First-connect server identity check; verify muna ang host key.'],
    ['Walang output ang Set-Clipboard?', 'Normal; i-paste ang copied public key sa cPanel field.'],
    ['Public key ba ang fingerprint?', 'Hindi. Buong ssh-ed25519 line ang ini-import, hindi SHA256 label.'],
    ['Na-add sa Wizard, ready na app?', 'DB/user permissions pa lang; kailangan import, env, build, tests.'],
    ['Bakit account exists kahit email failed?', 'Na-commit na ang registration bago pumalya ang SMTP send.'],
    ['Bakit walang Delete sa Inactive?', 'Active-only ang button; soft deactivation ang existing implementation.'],
    ['Puwedeng both localhost at live Google?', 'Oo. Panatilihin ang localhost origin at magdagdag ng live origin.'],
    ['Naka-SSH na, remote na ang Explorer?', 'Hindi. Remote terminal lamang; local pa rin ang opened folder.'],
    ['Kapag Save o git push, live agad?', 'Hindi sa current setup. Kailangan pa ng reviewed deploy/build/restart.'],
    ['Same steps sa lahat ng Nuxt projects?', 'Same broad flow, pero project-specific ang scripts, paths, DB schema at OAuth flow.'],
], [193, 311])

page('Worksheet para sa susunod mong system')
table([
    ['Field', 'Ilalagay sa bagong project'],
    ['Live URL', 'https://<app>.<domain>'],
    ['Local development folder', '<sariling local source path>'],
    ['Deployment folder', '<separate reviewed deployment copy>'],
    ['cPanel account / SSH host / port', '<user> / <server> / <hosting-provided port>'],
    ['Application root / startup file', '/home/<user>/<app> / <implemented entry point>'],
    ['Private storage root', '/home/<user>/<app>-private'],
    ['Database / dedicated DB user', '<actual cPanel-prefixed names>'],
    ['Node / npm / database engine', '<supported and verified versions>'],
    ['GitHub repository', '<owner>/<project> - Private'],
    ['Secrets', '**** - ilagay sa private config o password manager, hindi sa worksheet'],
    ['Release record', '<deployed commit> + <build date> + <verification result>'],
], [184, 320])
sub('Ulitin ang deployment sa ganitong order')
para('1. Local backup at source review. 2. Domain/SSL. 3. Node app. 4. Source upload. 5. Linux dependencies. 6. Dedicated DB/user at initial import. 7. Private files. 8. Saved environment. 9. Linux build at restart. 10. OAuth/SMTP. 11. Functional tests at backups. 12. SSH key at private code history. 13. Reviewed updates at release tracking.')
para('Bago gamitin sa actual payroll, kumpletuhin ang business computations, permissions, recovery at persistent-file tests. Ang generated sample screens ay guide sa navigation, hindi garantiya na pareho ang UI/version ng susunod mong hosting account.')

page('Sample startup files para sa bagong Nuxt project')
para('Minimal example ito para maintindihan kung saan nanggaling ang startup file natin. Hindi ito instruction na i-overwrite ang current deployment wrapper, na may sarili nang configuration validation.')
sub('deployment/namecheap/package.json')
code('''{
  "private": true,
  "type": "commonjs"
}''')
sub('deployment/namecheap/app.js')
code('''const path = require('node:path')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '../..')
process.chdir(root)
process.env.NODE_ENV = 'production'
const entry = path.join(root, '.output/server/index.mjs')
import(pathToFileURL(entry).href).catch(error => {
  console.error('[startup]', error.code || error.name)
  process.exitCode = 1
})''')
sub('Halimbawa ng build script sa root package.json')
code('''"scripts": {
  "build:hosting": "node --max-old-space-size=1200 node_modules/nuxt/bin/nuxt.mjs build"
}''')
para('I-merge lamang ang scripts entry sa existing package.json; huwag palitan ang buong file o dependencies. Ginamit natin ang node-server Nitro preset sa hosting build. Panatilihin ang project-specific build metadata at validation kung mayroon na.')
para('Sa cPanel, relative startup path ay deployment/namecheap/app.js at application root ang folder na may .output. Ang .vue files ay source na bina-build; hindi sila hiwa-hiwalay na PHP pages na basta binubuksan sa phpMyAdmin.')
note('Para sa ibang Nuxt version o hosting provider, i-check ang supported deployment preset at entry point. Linux build, correct runtime configuration, at smoke tests pa rin ang kailangan.')

page('Official references at completed status')
refs = [
    ('1', 'Namecheap Node.js applications', 'https://www.namecheap.com/support/knowledgebase/article.aspx/10047/2182/how-to-work-with-nodejs-app/'),
    ('2', 'Namecheap phpMyAdmin import at export', 'https://www.namecheap.com/support/knowledgebase/article/9143/2180/how-to-import-and-export-a-database-via-phpmyadmin-access-denied-create-database-db_name-error/'),
    ('3', 'Google Identity Services code model', 'https://developers.google.com/identity/oauth2/web/guides/use-code-model'),
    ('4', 'Namecheap SSH availability', 'https://www.namecheap.com/support/knowledgebase/article.aspx/131/22/do-you-provide-ssh-if-yes-under-what-conditions/'),
    ('5', 'Namecheap cPanel password reset', 'https://www.namecheap.com/support/knowledgebase/article.aspx/733/29/how-can-i-reset-my-cpanel-password/'),
    ('6', 'Namecheap SSH keys', 'https://www.namecheap.com/support/knowledgebase/article.aspx/9428/89/how-to-connect-via-ssh-using-keys/'),
    ('7', 'MariaDB CREATE VIEW at DEFINER', 'https://mariadb.com/docs/server/server-usage/views/create-view'),
    ('8', 'MariaDB generated columns at cascading foreign keys', 'https://jira.mariadb.org/browse/MDEV-18114'),
    ('9', 'GitHub existing local code import', 'https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github'),
]
for number, title, url in refs:
    para(f'<b>[{number}]</b> <link href="{escape(url)}" color="#2459da">{escape(title)}</link>')
sub('Natapos ayon sa session')
para('Working Linux production build, imported database, configured private paths, successful readiness, Google login, user-reported employee creation, SSH key authorization/login, at successful initial GitHub main push. Na-confirm mong ginawang Private ang repo bago ang successful push.')
sub('Hindi pa completed o hindi pa fully verified')
para('One-click deploy task at automatic rollback; full role/business acceptance; scheduled backups at isolated restore; SMTP delivery at signup resend UX; complete server-source-to-commit comparison; Linux OCR replacement; real hosting concurrency assessment.')
note('Version 1 - November 16, 2026, Asia/Singapore. Project-specific record at reusable workflow guide. Sensitive values intentionally omitted; no actual server operations are performed by this PDF.')

def footer(c, doc):
    c.saveState()
    c.setFont('Body', 8)
    c.setFillColor(MUTED)
    c.drawString(54, 28, 'Nuxt at Namecheap deployment | Sample screens | 16 Nov 2026')
    c.drawRightString(558, 28, str(doc.page))
    c.restoreState()

class GuideDoc(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name in ('HeadingX', 'TitleX'):
            title = flowable.getPlainText()
            key = 'section-' + str(self.page)
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title, key, level=0, closed=False)

doc = GuideDoc(str(OUT), pagesize=letter, leftMargin=54, rightMargin=54,
                        topMargin=44, bottomMargin=48, title='Gabay sa Nuxt deployment sa Namecheap',
                        author='DJA Payroll deployment documentation',
                        subject='Filipino step-by-step guide with generated sample screens and masked secrets')
doc.build(STORY, onFirstPage=footer, onLaterPages=footer)
print(OUT)
print('Planned sections:', len(PAGE_TITLES))

# Generate a visual-review rendering and machine-readable layout diagnostics.
import fitz
review = Path(__file__).resolve().parent / 'rendered'
review.mkdir(exist_ok=True)
pdf = fitz.open(OUT)
for i, pg in enumerate(pdf):
    pg.get_pixmap(matrix=fitz.Matrix(1.2, 1.2), alpha=False).save(review / f'page-{i+1:02d}.png')
print('Rendered pages:', len(pdf))
print('Output bytes:', OUT.stat().st_size)
if len(pdf) != len(PAGE_TITLES):
    print('WARNING: page overflow; review and fix before delivery')
for i, pg in enumerate(pdf):
    bad = [b for b in pg.get_text('blocks') if b[0] < 40 or b[2] > 570 or b[1] < 20 or b[3] > 767]
    if bad:
        print('Bounds review needed:', i+1, len(bad))
pdf.close()

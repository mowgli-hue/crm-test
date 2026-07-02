# Install the Acrobat "Newton: Import Case Data" helper

This adds a one-click menu item to Adobe Acrobat that imports the agent's
generated data into a blank certified IRCC form — the cert-preserving path that
keeps Validate + the 2D barcode working. You install it **once**.

## 1. Copy the script into Acrobat's folder-level JavaScripts directory

macOS (Adobe Acrobat / DC):

```bash
mkdir -p ~/Library/Application\ Support/Adobe/Acrobat/DC/JavaScripts
cp newton_import.js ~/Library/Application\ Support/Adobe/Acrobat/DC/JavaScripts/
```

> If that exact folder doesn't exist, your Acrobat uses a different version
> subfolder (e.g. `.../Adobe/Acrobat/2020/JavaScripts`). Look under
> `~/Library/Application Support/Adobe/Acrobat/` and use the `JavaScripts`
> folder there. Create it if missing.

## 2. Enable folder-level JavaScript

Acrobat → Settings/Preferences → **JavaScript**:
- ✅ Enable Acrobat JavaScript
- ✅ Enable menu items JavaScript execution privileges
- (Leave the rest at defaults.)

Then **quit and reopen Acrobat**. Folder-level scripts load at startup.

## 3. Confirm

Open any PDF. The **Edit** menu should now show **"Newton: Import Case Data"**
at the top.

## 4. Point it at the right inbox

`newton_import.js` reads from:

```
/Users/junglelabs/NewtonAgent/inbox/import.xml
```

This must match `config.yaml → paths.acrobat_inbox` (+ `/import.xml`). If the
Mac account name isn't `junglelabs`, edit `NEWTON_INBOX` in the script and re-copy.

## Using it (per form)

1. Open a **copy** of the blank form (`blank_immXXXX.pdf`) — never the template.
2. The agent stages the case's data to the inbox (`stage_import_file`).
3. **Edit → Newton: Import Case Data** → fields populate.
4. Click **Validate** (blue button, top of page 1) → barcode is generated.
5. **Save As** into the case's submission folder.

## ⚠️ One live verification still needed

`Doc.importXFAData()` accepting a file path is documented to work on **certified**
forms in the menu/console context (which is why this is a menu item). It has not
yet been run on this specific Acrobat build. First run: do steps 1–4 once with the
Lovepreet test data and confirm the fields fill and Validate stamps the barcode.
If the path form isn't accepted on this build, the fallback is Acrobat's
**Edit → Form Options → Import Data…** run inside **Adobe Reader** (which honors the
certified form's fill-in rights without the Pro "restricted feature" prompt).

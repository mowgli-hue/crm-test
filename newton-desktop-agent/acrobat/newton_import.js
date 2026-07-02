/* newton_import.js — Adobe Acrobat folder-level script for Newton Immigration.
 *
 * Adds an Edit-menu item "Newton: Import Case Data" that imports the agent's
 * generated XFA data into the currently open BLANK, certified IRCC form.
 *
 * Why a folder-level menu item (not a form button):
 *   Doc.importXFAData() is only permitted in the batch / menu / console context,
 *   never a button callback. A folder-level menu item runs in "menu" context, and
 *   because IRCC's form stays certified, importing preserves the JavaScript that
 *   generates the 2D barcode at Validate time.
 *
 * Flow for the operator (or the computer-use runner):
 *   1. Open a COPY of the blank form (blank_immXXXX.pdf).
 *   2. Edit menu -> "Newton: Import Case Data"  (imports NEWTON_INBOX).
 *   3. Click Validate.  4. Save As into the case's submission folder.
 *
 * The agent stages the data for the current case at NEWTON_INBOX before step 2.
 */

// Keep this path in sync with config.yaml -> paths.acrobat_inbox + "/import.xml".
// Adjust the username if the firm's Mac account differs.
var NEWTON_INBOX = "/Users/junglelabs/NewtonAgent/inbox/import.xml";

var newtonImportCaseData = app.trustedFunction(function () {
    app.beginPriv();
    try {
        var doc = event.target;
        if (!doc) {
            app.alert("Open a blank IRCC form first, then run this.");
            return;
        }
        // Import the data file the agent generated for the current case.
        doc.importXFAData(NEWTON_INBOX);
        app.alert(
            "Newton: data imported.\n\nNow click Validate, then Save As into " +
            "the case's submission folder. (Do NOT overwrite the blank template.)"
        );
    } catch (e) {
        app.alert("Newton import failed:\n" + e +
            "\n\nCheck that the agent wrote " + NEWTON_INBOX);
    } finally {
        app.endPriv();
    }
});

app.addMenuItem({
    cName:   "NewtonImportCaseData",
    cUser:   "Newton: Import Case Data",
    cParent: "Edit",
    cExec:   "newtonImportCaseData()",
    nPos:    0
});

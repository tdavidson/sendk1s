# k1distribution
 
This folder covers scripts created to send K1 tax documents to limited partners for Laconia Capital Group.

[Here's a video overview on how it works](https://www.loom.com/share/bad8633bf10c4b1f842de6d666a7dd6f).

## Installation:

- `npm install` to install the dependencies and node
- `brew install pdftk-java` (use homebrew on a mac)

if you have to install homebrew to install pdftk-java:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
then add brew to the path
```
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```
then install pdftk-java
```
brew install pdftk-java
```
## test_k1s.js

This is a test script that will test the matching of the PDF files to the email CSV file. It will not send any emails, but instead create a CSV file with the results of what each file was matched to. Run this before sending any emails.

## k1script.js

1. Put the unencrypted K1s in a folder in the `ignore` folder, which is ignored by git, so all the K1s are not synched to Github.
2. Run the script, passing in the name of the folder to process.

```
node k1script.js [name of folder with full file path, including the "ignore" folder, excluding the leading "/" from the file path]
```

3. The encrypted folders will be created in the `ignore` folder with the same folder name, with `_protected` appended.
4. The script will create a CSV file in the `ignore` folder, with the same name as the folder, but with a `_passwords` suffix. You can use this to verify the passwords are correct and the script worked correctly. Please note this should stay in the `ignore` folder so it is also ignored by git.

## send_k1s.js

This script is used to send the K1s to the limited partners, using the finance@ email address.

> There are two versions of the script, one for Gmail and one for SendGrid, both have been tested and work. The gmail version requires a credentials.json file from Google Cloud Console. The sendgrid verion requires a sendgrid api key. Both of these are setup using the finance@ email address. Sendgrid is easy to use but domain authentication is required to remove the spoof warning that many email providers will show. Gmail is nice because it sends the emails from the sent items folder so it's in the inbox and easy to find. Gmail was used to distribute the 2024 K1s.

The script requires three files, which you can put in any organizational system you want. 

- Email template with subject and body of the email
- K1s to send, in PDF format
- CSV file with the LP names and email addresses for distribution

The key is to keep any confidential documents in the `/ignore` folder (originally, the `docs` folder) so that they are ignored by git.

1. Create the email template.txt file with the subject line and body of the email.
2. Create a .csv file with the LP names and email addresses for distribution. This file needs to contain two columns: identifier and email.

```
identifier,email
LP001,john.doe@example.com
ACME_LLC,contact@acme.com
LP001,john.doe@example.com;jane.doe@example.com
"ACME LLC",contact@acme.com;finance@acme.com;tax@acme.com
```

Important notes:
- The identifier should exactly match part (any part)of the K-1 PDF filename for that LP
- Make sure there are no spaces after the commas
- The header row (identifier,email) is required
- Each LP should be on a new line
- Use semicolons (;) to separate multiple email addresses. You can add as many email addresses as needed for each LP.
- You can create this file using any text editor or spreadsheet software (just export as CSV)
- If you're using Excel or Google Sheets:
  - Create a spreadsheet with two columns
  - Label column A as "identifier" and column B as "email"
- For CSV files with values containing commas, you need to enclose those values in quotes. Key points:
  - Enclose the identifier in double quotes when it contains a comma.
  - The email field doesn't need quotes unless it contains commas (semicolons are fine without quotes)
  - If a field contains both commas and quotes, use double quotes and escape internal quotes by doubling them:

```
node send_k1s_gmail.js [path to pdf folder_protected] [path to csv/name of email list csv file] [path to email template/name of email template]
```

## Notes on authorization for sending emails

### Gmail
To send the email, you will have to go to Google Cloud Console and download the credentials file, and rename it to `credentials.json`. The first time you run the script, it will take you to a Google Cloud website to authorize the app, which will generate the `token.json` file. You will not have to authorize the app again. If you ever need to force a new authorization (for example, if you want to use a different Google account or if the token expires), you can simply delete the token.json file and run the `send_k1s_gmail.js` script again. The script will then prompt you to go through the authorization flow again. 

### Sendgrid
To remove the spoof warning and improve deliverability, you'll need to authenticate your domain with SendGrid. Here's how:

- Go to SendGrid Settings → Sender Authentication
- Click "Authenticate Your Domain"
- Enter your domain
- You'll get DNS records to add to your domain:
  - CNAME records for domain authentication
  - DKIM records for email signing
  - A custom return-path record
- Add these records to your DNS settings (through your domain provider or DNS manager)
- Wait for SendGrid to verify the records (can take up to 48 hours, but usually much faster)
- After domain authentication is complete:
  - No more spoof warnings
  - Better inbox placement
  - Higher deliverability rates
  - Protection against email spoofing
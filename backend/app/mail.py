"""Versturen van e-mail via SMTP (standaard het Ziggo-account van de club).

Verzending gebeurt vanuit een BackgroundTask, zodat een trage of onbereikbare
SMTP-server een webrequest nooit ophoudt. Fouten worden gelogd maar nooit aan de
gebruiker getoond: dat zou verraden of een e-mailadres bestaat.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

from app.config import get_settings

logger = logging.getLogger(__name__)


def send_mail(to: str, subject: str, text_body: str, html_body: str | None = None) -> None:
    settings = get_settings()
    if not settings.mail_enabled:
        logger.warning("E-mail staat uit; bericht aan %s niet verstuurd", to)
        return
    if not settings.smtp_host or not settings.mail_from:
        logger.error("SMTP is niet geconfigureerd; bericht aan %s niet verstuurd", to)
        return

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((settings.smtp_from_name, settings.mail_from))
    message["To"] = to
    # Date en Message-ID zijn verplicht volgens RFC 5322 en smtplib vult ze niet
    # aan. Zonder deze headers rekenen spamfilters punten aan, waardoor
    # bevestigings- en herstelmails in de spammap belanden.
    message["Date"] = formatdate(localtime=True)
    domain = settings.mail_from.rpartition("@")[2] or None
    message["Message-ID"] = make_msgid(domain=domain)
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    try:
        context = ssl.create_default_context()
        if settings.smtp_ssl:
            with smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=settings.smtp_timeout,
                context=context,
            ) as server:
                _login_and_send(server, message, settings)
        else:
            with smtplib.SMTP(
                settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout
            ) as server:
                server.ehlo()
                if settings.smtp_starttls:
                    server.starttls(context=context)
                    server.ehlo()
                _login_and_send(server, message, settings)
        logger.info("E-mail '%s' verstuurd naar %s", subject, to)
    except Exception as exc:
        logger.error("Versturen van e-mail naar %s mislukt: %s", to, exc)


def _login_and_send(server: smtplib.SMTP, message: EmailMessage, settings) -> None:
    if settings.smtp_user and settings.smtp_password:
        server.login(settings.smtp_user, settings.smtp_password)
    server.send_message(message)


# ------------------------------------------------------------------ sjablonen

_STYLE = (
    "font-family:Archivo,Helvetica,Arial,sans-serif;color:#1f2933;"
    "line-height:1.6;max-width:520px;margin:0 auto"
)
_BUTTON = (
    "display:inline-block;background:#F4244E;color:#ffffff;text-decoration:none;"
    "padding:12px 24px;border-radius:6px;font-weight:600"
)


def _wrap(title: str, intro: str, url: str, button: str, footer: str) -> str:
    return f"""\
<div style="{_STYLE}">
  <h2 style="color:#F4244E;margin-bottom:4px">{title}</h2>
  <p>{intro}</p>
  <p style="margin:28px 0"><a href="{url}" style="{_BUTTON}">{button}</a></p>
  <p style="font-size:13px;color:#616e7c">
    Werkt de knop niet? Kopieer dan deze link naar je browser:<br />
    <a href="{url}" style="color:#F4244E">{url}</a>
  </p>
  <p style="font-size:13px;color:#616e7c">{footer}</p>
</div>"""


def send_verification_mail(to: str, name: str, url: str, ttl_hours: int) -> None:
    subject = "Bevestig je account voor het Routeboek"
    text = (
        f"Hallo {name},\n\n"
        "Welkom bij het routeboek van Maximus Stampers. Bevestig je e-mailadres "
        f"via onderstaande link:\n\n{url}\n\n"
        f"De link is {ttl_hours} uur geldig.\n\n"
        "Heb je zelf geen account aangemaakt? Dan kun je deze mail negeren.\n"
    )
    html = _wrap(
        "Welkom bij het Routeboek",
        f"Hallo {name}, bevestig je e-mailadres om te kunnen inloggen.",
        url,
        "Bevestig mijn account",
        f"De link is {ttl_hours} uur geldig. "
        "Heb je zelf geen account aangemaakt? Dan kun je deze mail negeren.",
    )
    send_mail(to, subject, text, html)


def send_password_reset_mail(to: str, name: str, url: str, ttl_minutes: int) -> None:
    subject = "Nieuw wachtwoord instellen voor het Routeboek"
    text = (
        f"Hallo {name},\n\n"
        "Er is een nieuw wachtwoord aangevraagd voor je account. Stel het in via "
        f"onderstaande link:\n\n{url}\n\n"
        f"De link is {ttl_minutes} minuten geldig.\n\n"
        "Heb je dit niet aangevraagd? Dan hoef je niets te doen; je wachtwoord "
        "blijft ongewijzigd.\n"
    )
    html = _wrap(
        "Nieuw wachtwoord instellen",
        f"Hallo {name}, je hebt een nieuw wachtwoord aangevraagd.",
        url,
        "Nieuw wachtwoord instellen",
        f"De link is {ttl_minutes} minuten geldig. Heb je dit niet aangevraagd? "
        "Dan hoef je niets te doen; je wachtwoord blijft ongewijzigd.",
    )
    send_mail(to, subject, text, html)

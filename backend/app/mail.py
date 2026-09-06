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


def send_route_rating_mail(to: str, name: str, route_name: str, route_url: str) -> None:
    """'Beoordeel je rit'-mail, de ochtend na een rit met deze route.

    Rijker opgemaakt dan de andere sjablonen (logo + rode banner, net als
    stampers.cc/routeboek.cc) omdat dit geen beveiligingsmail is maar een
    vriendelijk verzoek; hier mag de huisstijl wat nadrukkelijker naar voren
    komen. De sterren zijn decoratief (e-mailclients voeren geen JavaScript
    uit); de knop brengt de lezer naar de route, waar echt beoordeeld wordt.
    """
    settings = get_settings()
    logo_url = f"{settings.base_url}/brand/stampers-logo.png"
    subject = f"Beoordeel jouw rit: {route_name}"
    text = (
        f"Hallo {name},\n\n"
        f"Je hebt gisteren met de club de route '{route_name}' gereden. We "
        "zouden het fijn vinden als je deze route een beoordeling geeft. Dit "
        "helpt om de kwaliteit van de routes in het routeboek hoog te "
        f"houden.\n\nBeoordeel de route via:\n{route_url}\n\n"
        "Heb je deze route al beoordeeld? Dan kun je deze mail negeren.\n"
    )
    stars = "".join(
        '<span style="color:#f2b400;font-size:26px;letter-spacing:4px">&#9733;</span>'
        for _ in range(5)
    )
    html = f"""\
<div style="background:#f4f4f4;padding:24px 0;font-family:Archivo,Helvetica,Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:10px;
              overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08)">
    <div style="padding:24px 0;text-align:center;border-bottom:1px solid #eef0f2">
      <img src="{logo_url}" alt="Maximus Stampers" height="42" style="height:42px" />
    </div>
    <div style="background:#F4244E;padding:22px 28px">
      <h1 style="margin:0;color:#ffffff;font-size:22px">Beoordeel jouw rit</h1>
    </div>
    <div style="padding:28px;color:#1f2933;line-height:1.6">
      <p>Beste {name},</p>
      <p>
        Je hebt gisteren met de club de route hieronder gereden. We zouden
        het erg fijn vinden als je deze een beoordeling geeft. Dit helpt ons
        om de kwaliteit van de routes in het routeboek zo hoog mogelijk te
        houden.
      </p>
      <p style="text-align:center;margin:28px 0 4px">
        <a href="{route_url}" style="color:#F4244E;font-weight:700;
           font-size:17px;text-decoration:none">{route_name}</a>
      </p>
      <p style="text-align:center;margin:8px 0 24px">{stars}</p>
      <p style="text-align:center;margin:0 0 28px">
        <a href="{route_url}" style="{_BUTTON}">Beoordeel deze route</a>
      </p>
      <p style="font-size:13px;color:#616e7c;margin-top:32px">
        Heb je deze route al beoordeeld? Dan kun je deze mail negeren; je
        krijgt 'm dan ook niet nog een keer voor dezelfde route.
      </p>
    </div>
    <div style="background:#f8f9fb;padding:16px 28px;text-align:center;
                font-size:12px;color:#8a97a3">
      Met sportieve groet,<br /><strong>Maximus Stampers Routeboek</strong>
    </div>
  </div>
</div>"""
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

UPDATE payments SET covers_month = substr(paid_date, 1, 7) WHERE covers_month IS NULL;

UPDATE payments SET receipt_no = 'RCPT-' || printf('%06d', id) WHERE receipt_no IS NULL;

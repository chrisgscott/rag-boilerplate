from unittest.mock import MagicMock, patch


def test_bump_cache_version():
    """bump_cache_version increments the org's cache_version by 1."""
    from src.worker import bump_cache_version

    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__ = lambda s: mock_cursor
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

    with patch("src.worker._get_db_connection", return_value=mock_conn):
        bump_cache_version("org-123")

    mock_cursor.execute.assert_called_once_with(
        "UPDATE organizations SET cache_version = cache_version + 1 WHERE id = %s",
        ("org-123",),
    )
    mock_conn.commit.assert_called_once()
    mock_conn.close.assert_called_once()
